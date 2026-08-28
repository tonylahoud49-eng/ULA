import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promptText } from "../ai/providers/openaiProvider.mjs";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved Bulk Vessels profile contains methodology only and no supplied historical claim facts", async () => {
  const text = await fs.readFile(new URL("../ai/references/bulk-vessels-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "bulk-vessels");
  assert.match(text, /hatch-cover allegations/i);
  assert.match(text, /bag damage and discharge handling/i);
  assert.match(text, /For fire claims/i);
  assert.match(text, /For shortage/i);
  assert.match(text, /Calculate quantum locally/i);
  assert.doesNotMatch(text, /AGIA IOANNA|MV DOCE|ZHE HAI 515|HOANG ANH 36|250,188\.80|42,672\.88|241112|260520|260331|250915|427603|13791811/i);
});

test("production Bulk Vessels profile is automatically scoped to current bulk or breakbulk evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const bulkEvidence = [{
    document_id: "current-bill",
    document_name: "bill-of-lading.pdf",
    pages: [{ page: 1, text: "The bulk carrier loaded grain in bulk into cargo holds 1 through 5." }],
  }];
  const containerEvidence = [{
    document_id: "current-bill",
    document_name: "bill-of-lading.pdf",
    pages: [{ page: 1, text: "Dry container cargo shipped under one sealed container bill of lading." }],
  }];

  const bulk = selectApplicableStyleReferences(references, { claim: { business_line: "Bulk Vessel" }, evidence: bulkEvidence });
  const unclassified = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: bulkEvidence });
  const wrongLine = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Non-Reefer)" }, evidence: bulkEvidence });
  const unrelated = selectApplicableStyleReferences(references, { claim: { business_line: "Bulk Vessel" }, evidence: containerEvidence });

  assert.equal(bulk.some((item) => item.profile_id === "bulk-vessels"), true);
  assert.equal(unclassified.some((item) => item.profile_id === "bulk-vessels"), true);
  assert.equal(wrongLine.some((item) => item.profile_id === "bulk-vessels"), false);
  assert.equal(unrelated.some((item) => item.profile_id === "bulk-vessels"), false);
  assert.match(promptText({ business_line: "Bulk Vessel" }, bulkEvidence, references), /Bulk Vessels and Breakbulk Cargo/);
  assert.doesNotMatch(promptText({ business_line: "Bulk Vessel" }, containerEvidence, references), /Bulk Vessels and Breakbulk Cargo/);
});
