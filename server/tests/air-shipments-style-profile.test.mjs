import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promptText } from "../ai/providers/openaiProvider.mjs";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved Air Shipments profile contains methodology only and no supplied historical claim facts", async () => {
  const text = await fs.readFile(new URL("../ai/references/air-shipments-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "air-shipments");
  assert.match(text, /master air waybill, house air waybill/i);
  assert.match(text, /temperature-sensitive air cargo/i);
  assert.match(text, /For non-delivery/i);
  assert.match(text, /professional-packing warranty/i);
  assert.match(text, /Calculate quantum locally/i);
  assert.doesNotMatch(text, /Turkish Airlines|Aramex|UPS|Arope|Azadea|American University of Beirut|2,420\.16|2,889\.00|12,636\.00|250425|250545|250721|260303|235-11534950|1Z417V208658737740/i);
});

test("production Air Shipments profile is automatically scoped to current air-carriage evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const airEvidence = [{
    document_id: "current-awb",
    document_name: "current-air-waybill.pdf",
    pages: [{ page: 1, text: "Air Waybill records air freight from the airport of departure to the airport of destination." }],
  }];
  const seaEvidence = [{
    document_id: "current-bill",
    document_name: "current-bill-of-lading.pdf",
    pages: [{ page: 1, text: "Ocean bill of lading for container cargo carried by sea." }],
  }];

  const air = selectApplicableStyleReferences(references, { claim: { business_line: "Air Shipment (NET)" }, evidence: airEvidence });
  const unclassified = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: airEvidence });
  const wrongLine = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Non-Reefer)" }, evidence: airEvidence });
  const unrelated = selectApplicableStyleReferences(references, { claim: { business_line: "Air Shipment (NET)" }, evidence: seaEvidence });

  assert.equal(air.some((item) => item.profile_id === "air-shipments"), true);
  assert.equal(unclassified.some((item) => item.profile_id === "air-shipments"), true);
  assert.equal(wrongLine.some((item) => item.profile_id === "air-shipments"), false);
  assert.equal(unrelated.some((item) => item.profile_id === "air-shipments"), false);
  assert.match(promptText({ business_line: "Air Shipment (NET)" }, airEvidence, references), /Air Shipments - Owner-Approved Methodology Profile/);
  assert.doesNotMatch(promptText({ business_line: "Air Shipment (NET)" }, seaEvidence, references), /Air Shipments - Owner-Approved Methodology Profile/);
});
