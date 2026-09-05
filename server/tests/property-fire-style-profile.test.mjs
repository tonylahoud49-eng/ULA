import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promptText } from "../ai/providers/openaiProvider.mjs";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved Property and Fire profile contains generic methodology only", async () => {
  const text = await fs.readFile(new URL("../ai/references/property-fire-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "property-fire");
  assert.match(text, /Distinguish the insured peril of fire from the mechanism that ignited it/i);
  assert.match(text, /trace the credible water path/i);
  assert.match(text, /burnt contactor, breaker, cable or panel is not by itself proof/i);
  assert.match(text, /smallest evidenced unit/i);
  assert.match(text, /exact missing document, report, test, witness statement/i);
  assert.doesNotMatch(text, /Mashrek|Debahy|Alakso|Aour|Rahbani|Toufic|FAP\/2025|PAR\/2024|USD 138,891|USD 1,941/i);
});

test("Property and Fire profile is scoped to current property evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const propertyEvidence = [{
    document_id: "property-fire-policy",
    document_name: "property-fire-claim.pdf",
    pages: [{ page: 1, text: "Commercial Fire Risk policy for the insured premises. Civil Defense report records fire damage to the building." }],
  }];
  const cargoEvidence = [{
    document_id: "cargo-fire-bill",
    document_name: "cargo-fire-claim.pdf",
    pages: [{ page: 1, text: "Marine cargo claim under a bill of lading: fire damage to containerized goods." }],
  }];

  const property = selectApplicableStyleReferences(references, { claim: { business_line: "Property" }, evidence: propertyEvidence });
  const unclassifiedProperty = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: propertyEvidence });
  const cargo = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Non-Reefer)" }, evidence: cargoEvidence });

  assert.equal(property.some((item) => item.profile_id === "property-fire"), true);
  assert.equal(unclassifiedProperty.some((item) => item.profile_id === "property-fire"), true);
  assert.equal(cargo.some((item) => item.profile_id === "property-fire"), false);
  assert.match(promptText({ business_line: "Property" }, propertyEvidence, references), /Property and Fire - Owner-Approved Methodology Profile/);
  assert.doesNotMatch(promptText({ business_line: "Marine Cargo \(Non-Reefer\)" }, cargoEvidence, references), /Property and Fire - Owner-Approved Methodology Profile/);
});
