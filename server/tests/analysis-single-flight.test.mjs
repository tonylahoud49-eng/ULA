import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisSingleFlightKey,
  runAnalysisSingleFlight,
} from "../../src/api/analysisSingleFlight.js";

test("identical simultaneous UI analysis invocations execute one operation", async () => {
  const key = analysisSingleFlightKey({
    claim: { id: "claim-one" },
    documents: [{ id: "document-one", storage_key: "stored-one" }],
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  });
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const operation = async () => {
    calls += 1;
    await pending;
    return { ok: true };
  };

  const first = runAnalysisSingleFlight(key, operation);
  const second = runAnalysisSingleFlight(key, operation);
  release();

  assert.strictEqual(first, second);
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
});

test("a failed operation is not retried automatically and only a later explicit invocation can run", async () => {
  const key = "failed-analysis";
  let calls = 0;
  const operation = async () => {
    calls += 1;
    throw new Error("mock provider failure");
  };

  const first = runAnalysisSingleFlight(key, operation);
  const duplicate = runAnalysisSingleFlight(key, operation);
  await assert.rejects(first, /mock provider failure/);
  await assert.rejects(duplicate, /mock provider failure/);
  assert.equal(calls, 1);

  await assert.rejects(runAnalysisSingleFlight(key, operation), /mock provider failure/);
  assert.equal(calls, 2);
});
