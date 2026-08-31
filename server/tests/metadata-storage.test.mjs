import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_DATABASE_KEY, metadataStorage } from "../../src/api/metadataStorage.js";

const withBrowserStorage = async (localStorage, callback) => {
  const previousIndexedDb = globalThis.indexedDB;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.indexedDB = undefined;
  globalThis.localStorage = localStorage;
  try {
    await callback();
  } finally {
    globalThis.indexedDB = previousIndexedDb;
    globalThis.localStorage = previousLocalStorage;
  }
};

test("metadata storage preserves the legacy fallback when IndexedDB is unavailable", async () => {
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  await withBrowserStorage(localStorage, async () => {
    const database = { Claim: [{ id: "claim-1" }], ClaimDocument: [] };
    await metadataStorage.save(database);
    assert.deepEqual(await metadataStorage.load(() => ({ Claim: [] })), database);
    assert.equal(values.has(LEGACY_DATABASE_KEY), true);
  });
});

test("metadata storage reports a legacy quota failure without discarding data", async () => {
  const quotaError = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  const localStorage = {
    getItem: () => null,
    setItem: () => { throw quotaError; },
    removeItem: () => undefined,
  };

  await withBrowserStorage(localStorage, async () => {
    await assert.rejects(
      metadataStorage.save({ Claim: [] }),
      (error) => error.code === "metadata-quota-exceeded" && /storage is full/i.test(error.message),
    );
  });
});
