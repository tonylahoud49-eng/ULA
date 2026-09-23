import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisResultStore } from "../ai/analysisResultStore.mjs";

test("completed paid results survive store recreation and respect retry expiry", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-analysis-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fingerprint = "a".repeat(64);
  const completed = {
    state: "complete", expiresAt: Date.now() + 60_000,
    payload: { response_id: "already-paid", analysis: { summary: "Preserved result" } },
  };
  createAnalysisResultStore(directory).write(fingerprint, completed);
  const restarted = createAnalysisResultStore(directory);
  assert.deepEqual(restarted.read(fingerprint), completed);
  assert.equal(restarted.read("b".repeat(64)), null);
  restarted.write(fingerprint, { ...completed, expiresAt: 1 });
  assert.equal(restarted.read(fingerprint), null);
});

test("an unreadable saved result fails closed instead of permitting another charge", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-analysis-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fingerprint = "c".repeat(64);
  fs.writeFileSync(path.join(directory, `${fingerprint}.json`), "incomplete-json");
  assert.throws(() => createAnalysisResultStore(directory).read(fingerprint), SyntaxError);
  assert.throws(() => createAnalysisResultStore(directory).read("../outside"), /Invalid/);
});
