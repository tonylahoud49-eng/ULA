const DATABASE_NAME = "ula_claims_hub_documents_v1";
const STORE_NAME = "documents";
const IDB_REFERENCE_PREFIX = "idb-document:";
const SERVER_REFERENCE_PREFIX = "server-document:";

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
  return new DocumentStorageError(`Unable to ${action} the document.`, "storage-error", error);
};

const createKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const referenceForIdb = (storageKey) => `${IDB_REFERENCE_PREFIX}${storageKey}`;
const referenceForServer = (storageKey) => `${SERVER_REFERENCE_PREFIX}${storageKey}`;

const keyFromReference = (reference) => {
  if (!reference) return null;
  const str = String(reference);
  if (str.startsWith(SERVER_REFERENCE_PREFIX)) return str.slice(SERVER_REFERENCE_PREFIX.length);
  if (str.startsWith(IDB_REFERENCE_PREFIX)) return str.slice(IDB_REFERENCE_PREFIX.length);
  if (str.startsWith("/api/documents/file/")) return str.slice("/api/documents/file/".length);
  return str;
};

// Fallback IndexedDB implementation for offline / local-only cases
const openDatabase = (() => {
  let promise;
  return () => {
    if (promise) return promise;
    promise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new DocumentStorageError(
          "Document storage is unavailable in this browser.",
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
        "Document storage is busy in another tab.",
        "blocked",
      ));
    }).catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
})();

const runIdbRequest = async (mode, action, operation) => {
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

const saveBlobToIdb = async (blob, metadata = {}) => {
  const key = metadata.storageKey || createKey();
  const record = {
    key,
    blob,
    name: metadata.name || "document",
    mimeType: metadata.mimeType || blob.type || "application/octet-stream",
    size: blob.size,
    updatedAt: new Date().toISOString(),
  };

  await runIdbRequest("readwrite", "save", (store) => store.put(record));

  return {
    reference: referenceForIdb(key),
    storageKey: key,
    storageProvider: "indexeddb",
    size: record.size,
    mimeType: record.mimeType,
    url: null,
  };
};

export const documentStorage = {
  /**
   * Save a file to server disk storage (with fallback to IndexedDB).
   */
  async save(file) {
    if (!(file instanceof Blob)) {
      throw new DocumentStorageError("A valid file is required.", "invalid-file");
    }

    try {
      const formData = new FormData();
      const filename = file.name || "document";
      formData.append("file", file, filename);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        return {
          reference: referenceForServer(data.storage_key),
          storageKey: data.storage_key,
          storageProvider: "server_disk",
          size: data.file_size,
          mimeType: data.file_mime_type,
          url: data.file_url,
        };
      }
    } catch {
      // Server upload failed, fallback to IndexedDB
    }

    return saveBlobToIdb(file, { name: file.name, mimeType: file.type });
  },

  async importDataUrl(dataUrl, metadata = {}) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      const file = new File([blob], metadata.name || "document", { type: metadata.mimeType || blob.type });
      return await this.save(file);
    } catch (error) {
      throw normalizeError(error, "migrate");
    }
  },

  async get(reference) {
    const key = keyFromReference(reference);
    if (!key) throw new DocumentStorageError("This document has no storage reference.", "missing-reference");

    // 1. Try fetching from server disk storage
    try {
      const res = await fetch(`/api/documents/file/${encodeURIComponent(key)}`);
      if (res.ok) {
        const blob = await res.blob();
        return {
          key,
          blob,
          name: key,
          mimeType: blob.type || res.headers.get("content-type") || "application/octet-stream",
          size: blob.size,
          updatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Continue to IndexedDB
    }

    // 2. Try IndexedDB
    try {
      const record = await runIdbRequest("readonly", "read", (store) => store.get(key));
      if (record?.blob) {
        // Auto-upload to server in background for other users
        this.save(new File([record.blob], record.name || key, { type: record.mimeType })).catch(() => {});
        return record;
      }
    } catch {
      // Not in IndexedDB
    }

    throw new DocumentStorageError(
      "This document is not found on the server or in local storage.",
      "not-found",
    );
  },

  async resolveUrl(reference) {
    if (!reference) return { url: "", revoke: false };
    const str = String(reference);

    // Direct server URL
    if (str.startsWith("/api/documents/file/")) {
      return { url: str, revoke: false };
    }

    if (str.startsWith(SERVER_REFERENCE_PREFIX)) {
      const key = str.slice(SERVER_REFERENCE_PREFIX.length);
      return { url: `/api/documents/file/${encodeURIComponent(key)}`, revoke: false };
    }

    if (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("data:") || str.startsWith("blob:")) {
      return { url: str, revoke: false };
    }

    // IndexedDB reference
    try {
      const record = await this.get(reference);
      return { url: URL.createObjectURL(record.blob), revoke: true };
    } catch {
      return { url: `/api/documents/file/${encodeURIComponent(keyFromReference(reference))}`, revoke: false };
    }
  },

  async delete(reference) {
    const key = keyFromReference(reference);
    if (!key) return;

    try {
      await fetch(`/api/documents/${encodeURIComponent(key)}`, { method: "DELETE" });
    } catch {
      // Continue
    }

    try {
      await runIdbRequest("readwrite", "delete", (store) => store.delete(key));
    } catch {
      // Continue
    }
  },
};
