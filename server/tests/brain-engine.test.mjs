import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureBrainStorage,
  getBrainManifest,
  sanitizeBrainKnowledge,
  getBrainStyleReferences,
} from "../ai/brain/brainEngine.mjs";

test("ensureBrainStorage and getBrainManifest initialize correctly", async () => {
  await ensureBrainStorage();
  const manifest = await getBrainManifest();
  assert.ok(manifest);
  assert.equal(typeof manifest.total_learned_reports, "number");
  assert.ok(manifest.business_lines !== undefined);
});

test("sanitizeBrainKnowledge redacts specific claim entities, dates, currencies, and containers", () => {
  const claim = {
    claim_number: "CLM-999888",
    policy_number: "POL-777666",
    insured_name: "Acme Logistics Ltd",
    vessel_name: "MV Ocean Giant",
  };

  const learned = {
    methodology: "For claim CLM-999888 under policy POL-777666, Acme Logistics Ltd reported loss on MV Ocean Giant.",
    rules: [
      { guidance: "Verify seal integrity on container MSKU1234567 before concluding theft for Acme Logistics Ltd on 2026-05-12 with invoice $45,000.00." }
    ],
  };

  const sanitized = sanitizeBrainKnowledge(learned, claim);
  assert.ok(!sanitized.methodology.includes("CLM-999888"));
  assert.ok(!sanitized.methodology.includes("POL-777666"));
  assert.ok(!sanitized.methodology.includes("Acme Logistics Ltd"));
  assert.ok(!sanitized.methodology.includes("MV Ocean Giant"));
  assert.ok(!sanitized.rules[0].guidance.includes("Acme Logistics Ltd"));
  assert.ok(!sanitized.rules[0].guidance.includes("MSKU1234567"));
  assert.ok(!sanitized.rules[0].guidance.includes("2026-05-12"));
  assert.ok(!sanitized.rules[0].guidance.includes("$45,000.00"));
});

test("getBrainStyleReferences returns array of style references", async () => {
  const references = await getBrainStyleReferences();
  assert.ok(Array.isArray(references));
  for (const ref of references) {
    assert.equal(ref.source_role, "style_reference_only");
    assert.ok(ref.title);
  }
});

