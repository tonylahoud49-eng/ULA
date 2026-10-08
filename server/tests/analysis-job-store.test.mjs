import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalysisJobStore } from "../ai/analysisJobStore.mjs";

test("existing JSON input and nested visual checkpoints load byte-exactly with metadata intact", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-job-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createAnalysisJobStore(directory), id = "a".repeat(64);
  const bytes = Buffer.from(Array.from({ length: 2048 }, (_, index) => index % 256));
  // This is the existing on-disk format, not a fixture using the new reader.
  fs.mkdirSync(path.join(directory, id));
  fs.writeFileSync(path.join(directory, id, "input.json"), JSON.stringify({
    files: [{ buffer: bytes, originalname: "evidence.pdf" }],
    pages: [{ page: 7, text: "A cited fact", amount: 0, tags: [null, false, 1] }],
    vision_images: [{ page: 7, buffer: bytes.subarray(8, 64) }],
    embedded_images: [{ buffer: Buffer.alloc(0) }],
  }));
  assert.equal(store.has(id, "input"), true);
  const loaded = store.read(id, "input");
  assert.deepEqual(loaded.files[0].buffer, bytes);
  assert.deepEqual(loaded.vision_images[0].buffer, bytes.subarray(8, 64));
  assert.equal(Buffer.isBuffer(loaded.embedded_images[0].buffer), true);
  assert.deepEqual(loaded.pages, [{ page: 7, text: "A cited fact", amount: 0, tags: [null, false, 1] }]);
  store.write(id, "copy", loaded);
  assert.deepEqual(store.read(id, "copy"), loaded);
  assert.equal(store.has(id, "missing"), false);
  assert.throws(() => store.has(id, "../outside"), /Invalid checkpoint/);
});
