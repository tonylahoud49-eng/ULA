import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promptText } from "../ai/providers/openaiProvider.mjs";
import { createFreeDemoProvider } from "../ai/providers/freeDemoProvider.mjs";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved Non-Reefer profile contains methodology only and no supplied historical claim facts", async () => {
  const text = await fs.readFile(new URL("../ai/references/non-reefer-cargo-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "non-reefer-cargo");
  assert.match(text, /standard dry, high-cube, open-top/i);
  assert.match(text, /silver-nitrate, chloride, salinity/i);
  assert.match(text, /compare repair, cleaning, testing, replacement-part/i);
  assert.match(text, /Calculate quantum locally line by line/i);
  assert.match(text, /Do not apply a hypothetical or percentage recovery deduction/i);
  assert.match(text, /Assured and shipper differ, show both/i);
  assert.match(text, /original, sea waybill or draft/i);
  assert.match(text, /VAT or tax separately/i);
  assert.match(text, /observed condition; mechanism-compatible interpretation/i);
  assert.doesNotMatch(text, /AROPE|Lia Assurex|Fidelity Insurance|Maersk|MSC|CMA CGM|Saga Cosmetics|Alusteel|Almaza|Kinshasa|Cyprus|Canada|250742|250745|250901|251122|18,773|2,904|22,641|697\.00/i);
});

test("production Non-Reefer profile is scoped to current packaged sea-cargo evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const drySeaEvidence = [{
    document_id: "current-sea-bill",
    document_name: "current-evidence.pdf",
    pages: [{ page: 1, text: "Marine insurance policy by sea. One 40' HC container of packaged dry cargo under an ocean bill of lading." }],
  }];
  const landColdChainEvidence = [{
    document_id: "current-cmr",
    document_name: "current-cmr.pdf",
    pages: [{ page: 1, text: "Land transit under an international consignment note using a reefer truck with temperature loggers." }],
  }];
  const reeferSeaEvidence = [{
    document_id: "current-reefer",
    document_name: "current-reefer.pdf",
    pages: [{ page: 1, text: "Refrigerated marine container carrying frozen cargo at a required set point." }],
  }];

  const drySea = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Non-Reefer)" }, evidence: drySeaEvidence });
  const unclassified = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: drySeaEvidence });
  const wrongLine = selectApplicableStyleReferences(references, { claim: { business_line: "Land Shipment" }, evidence: drySeaEvidence });
  const unrelatedLand = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Non-Reefer)" }, evidence: landColdChainEvidence });
  const unrelatedReefer = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Reefer/GFS)" }, evidence: reeferSeaEvidence });

  assert.equal(drySea.some((item) => item.profile_id === "non-reefer-cargo"), true);
  assert.equal(unclassified.some((item) => item.profile_id === "non-reefer-cargo"), true);
  assert.equal(wrongLine.some((item) => item.profile_id === "non-reefer-cargo"), false);
  assert.equal(unrelatedLand.some((item) => item.profile_id === "non-reefer-cargo"), false);
  assert.equal(unrelatedReefer.some((item) => item.profile_id === "non-reefer-cargo"), false);
  assert.match(promptText({ business_line: "Marine Cargo (Non-Reefer)" }, drySeaEvidence, references), /Marine Non-Reefer Cargo - Owner-Approved Methodology Profile/);
  assert.doesNotMatch(promptText({ business_line: "Marine Cargo (Non-Reefer)" }, landColdChainEvidence, references), /Marine Non-Reefer Cargo - Owner-Approved Methodology Profile/);
});

test("local fallback distinguishes strong dry-sea evidence from land cold-chain evidence", async () => {
  const provider = createFreeDemoProvider();
  const drySea = await provider.analyze({
    claim: { business_line: "Unclassified" },
    evidence: [{
      document_id: "dry-sea",
      document_name: "dry-sea.txt",
      mime_type: "text/plain",
      extraction_status: "extracted",
      pages: [{ page: 1, text: "Marine cargo sea shipment in a dry container under an ocean bill of lading to the port of discharge." }],
    }],
  });
  const landColdChain = await provider.analyze({
    claim: { business_line: "Unclassified" },
    evidence: [{
      document_id: "land-cold",
      document_name: "land-cold.txt",
      mime_type: "text/plain",
      extraction_status: "extracted",
      pages: [{ page: 1, text: "Land transit road freight under a truck waybill and international consignment note using a reefer truck." }],
    }],
  });

  assert.equal(drySea.analysis.classification.business_line, "Marine Cargo (Non-Reefer)");
  assert.equal(landColdChain.analysis.classification.business_line, "Land Shipment");
});
