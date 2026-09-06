import test from "node:test";
import assert from "node:assert/strict";
import { repairTruncatedJson, safeParseJsonWithRepair } from "../ai/jsonRepair.mjs";

test("repairTruncatedJson repairs standard truncated JSON", () => {
  const truncated = '{"classification":{"business_line":"Marine Cargo","confidence":0.95},"fields":[{"field":"policy_number","value":"POL-123';
  const repaired = repairTruncatedJson(truncated);
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.classification.business_line, "Marine Cargo");
  assert.equal(parsed.fields[0].value, "POL-123");
});

test("repairTruncatedJson handles trailing colon", () => {
  const truncated = '{"title":"Test Claim","summary":';
  const repaired = repairTruncatedJson(truncated);
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.title, "Test Claim");
  assert.equal(parsed.summary, null);
});

test("repairTruncatedJson handles deeply nested arrays and objects", () => {
  const truncated = '{"data":{"items":[{"id":1,"tags":["urgent","marine';
  const repaired = repairTruncatedJson(truncated);
  const parsed = JSON.parse(repaired);
  assert.equal(parsed.data.items[0].tags[0], "urgent");
  assert.equal(parsed.data.items[0].tags[1], "marine");
});

test("safeParseJsonWithRepair does not throw on garbage or partial text", () => {
  const result = safeParseJsonWithRepair("random non-json text", { fallback: true });
  assert.ok(result);
});
