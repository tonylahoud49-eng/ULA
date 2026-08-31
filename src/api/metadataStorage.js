const DATABASE_NAME = "ula_claims_hub_metadata_v1";
const STORE_NAME = "application_state";
const RECORD_KEY = "database";
export const LEGACY_DATABASE_KEY = "ula_claims_hub_database_v1";

export class MetadataStorageError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = "MetadataStorageError";
    this.code = code;
  }
}

const normalizeError = (error, action) => {
  if (error instanceof MetadataStorageError) return error;
  const quotaExceeded = error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
  if (quotaExceeded) {
    return new MetadataStorageError(
      "Local application storage is full. Free some browser site storage, then try again.",
      "metadata-quota-exceeded",
      error,
    );
  }
  return new MetadataStorageError(
    `Unable to ${action} local application metadata. Check that browser site storage is enabled and try again.`,
    "metadata-storage-error",
    error,
  );
};

const readLegacyDatabase = () => {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_DATABASE_KEY);
    if (!raw) return { found: false, value: null };
    return { found: true, value: JSON.parse(raw) };
  } catch (error) {
    throw normalizeError(error, "read");
  }
};

const saveLegacyDatabase = (value) => {
  try {
    globalThis.localStorage?.setItem(LEGACY_DATABASE_KEY, JSON.stringify(value));
  } catch (error) {
    throw normalizeError(error, "save");
  }
};

const removeLegacyDatabase = () => {
  try {
    globalThis.localStorage?.removeItem(LEGACY_DATABASE_KEY);
  } catch {
    // IndexedDB already contains the durable copy. A stale legacy copy is harmless.
  }
};

const openDatabase = (() => {
  let promise;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new MetadataStorageError(
          "IndexedDB is unavailable in this browser.",
          "metadata-indexeddb-unavailable",
        ));
        return;
      }

      const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(normalizeError(request.error, "open"));
      request.onblocked = () => reject(new MetadataStorageError(
        "Local metadata storage is busy in another tab. Close other copies of the app and try again.",
        "metadata-storage-blocked",
      ));
    }).catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
})();

const runRequest = async (mode, action, operation) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result;

    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(normalizeError(transaction.error || request.error, action));
    transaction.onabort = () => reject(normalizeError(transaction.error || request.error, action));
  });
};

const indexedDbAvailable = () => Boolean(globalThis.indexedDB);

export const metadataStorage = {
  async load(createFallback) {
    if (!indexedDbAvailable()) {
      const legacy = readLegacyDatabase();
      return legacy.found ? legacy.value : createFallback();
    }

    const stored = await runRequest("readonly", "read", (store) => store.get(RECORD_KEY));
    if (stored?.value) return stored.value;

    const legacy = readLegacyDatabase();
    const value = legacy.found ? legacy.value : createFallback();
    await runRequest("readwrite", "migrate", (store) => store.put({ key: RECORD_KEY, value }));
    if (legacy.found) removeLegacyDatabase();
    return value;
  },

  async save(value) {
    if (!indexedDbAvailable()) {
      saveLegacyDatabase(value);
      return;
    }

    await runRequest("readwrite", "save", (store) => store.put({ key: RECORD_KEY, value }));
    removeLegacyDatabase();
  },
};
