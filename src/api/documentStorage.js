const DATABASE_NAME = "ula_claims_hub_documents_v1";
const STORE_NAME = "documents";
const REFERENCE_PREFIX = "idb-document:";

export class DocumentStorageError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = "DocumentStorageError";
    this.code = code;
  }
}

const normalizeError = (error, action) => {
  if (error instanceof DocumentStorageError) return error;
  if (error?.name === "QuotaExceededError") {
    return new DocumentStorageError(
      "This browser does not have enough space for that document. Free some site storage or connect external document storage, then try again.",
      "quota-exceeded",
      error,
    );
  }
  return new DocumentStorageError(`Unable to ${action} the document in local browser storage.`, "storage-error", error);
};

const createKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const referenceFor = (storageKey) => `${REFERENCE_PREFIX}${storageKey}`;

const keyFromReference = (reference) => {
  if (!reference) return null;
  return String(reference).startsWith(REFERENCE_PREFIX)
    ? String(reference).slice(REFERENCE_PREFIX.length)
    : String(reference);
};

const openDatabase = (() => {
  let promise;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new DocumentStorageError(
          "Document storage is unavailable in this browser. Enable site storage and try again.",
          "unavailable",
        ));
        return;
      }

      const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(normalizeError(request.error, "open"));
      request.onblocked = () => reject(new DocumentStorageError(
        "Document storage is busy in another tab. Close other copies of the app and try again.",
        "blocked",
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

const dataUrlToBlob = (dataUrl) => {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new DocumentStorageError("The legacy document data is invalid.", "invalid-data");

  const header = dataUrl.slice(0, separator);
  const body = dataUrl.slice(separator + 1);
  const mimeType = header.match(/^data:([^;,]+)/i)?.[1] || "application/octet-stream";
  const binary = header.includes(";base64") ? globalThis.atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
};

const saveBlob = async (blob, metadata = {}) => {
  if (!(blob instanceof Blob)) {
    throw new DocumentStorageError("A valid file is required.", "invalid-file");
  }

  const key = metadata.storageKey || createKey();
  const record = {
    key,
    blob,
    name: metadata.name || "document",
    mimeType: metadata.mimeType || blob.type || "application/octet-stream",
    size: blob.size,
    updatedAt: new Date().toISOString(),
  };

  try {
    await runRequest("readwrite", "save", (store) => store.put(record));
  } catch (error) {
    throw normalizeError(error, "save");
  }

  return {
    reference: referenceFor(key),
    storageKey: key,
    storageProvider: "indexeddb",
    size: record.size,
    mimeType: record.mimeType,
  };
};

export const documentStorage = {
  async save(file) {
    return saveBlob(file, { name: file.name, mimeType: file.type });
  },

  async importDataUrl(dataUrl, metadata = {}) {
    try {
      return await saveBlob(dataUrlToBlob(dataUrl), metadata);
    } catch (error) {
      throw normalizeError(error, "migrate");
    }
  },

  async get(reference) {
    const key = keyFromReference(reference);
    if (!key) throw new DocumentStorageError("This document has no storage reference.", "missing-reference");
    const record = await runRequest("readonly", "read", (store) => store.get(key));
    if (!record?.blob) {
      throw new DocumentStorageError(
        "This document is no longer available in local browser storage.",
        "not-found",
      );
    }
    return record;
  },

  async resolveUrl(reference) {
    if (reference && !String(reference).startsWith(REFERENCE_PREFIX)) {
      return { url: reference, revoke: false };
    }
    const record = await this.get(reference);
    return { url: URL.createObjectURL(record.blob), revoke: true };
  },

  async delete(reference) {
    const key = keyFromReference(reference);
    if (!key) return;
    await runRequest("readwrite", "delete", (store) => store.delete(key));
  },
};
