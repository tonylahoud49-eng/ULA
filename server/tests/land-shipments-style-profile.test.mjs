import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BUSINESS_LINES } from "../ai/claimAnalysisSchema.mjs";
import { promptText } from "../ai/providers/openaiProvider.mjs";
import { createFreeDemoProvider } from "../ai/providers/freeDemoProvider.mjs";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";
import { createUnifiedReportDraft } from "../../src/lib/reportingEngine.js";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved Land Shipments profile contains methodology only and no supplied historical claim facts", async () => {
  const text = await fs.readFile(new URL("../ai/references/land-shipments-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "land-shipments");
  assert.match(text, /CMR or international consignment note/i);
  assert.match(text, /Build a seal and access history/i);
  assert.match(text, /temperature-sensitive road cargo/i);
  assert.match(text, /Calculate quantum locally/i);
  assert.match(text, /subcontracted or successive haulier/i);
  assert.doesNotMatch(text, /AROPE|Net Freight|Interbrands|Albanna|Sanofi|Baghdad|Trebil|250616|250718|250822|251011|47,532|505,858/i);
});

test("production Land Shipments profile is automatically scoped to current land-carriage evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const landEvidence = [{
    document_id: "current-cmr",
    document_name: "current-consignment-note.pdf",
    pages: [{ page: 1, text: "International Consignment Note CMR records road transit under a truck waybill." }],
  }];
  const seaEvidence = [{
    document_id: "current-bill",
    document_name: "current-bill-of-lading.pdf",
    pages: [{ page: 1, text: "Ocean bill of lading for container cargo carried by sea." }],
  }];

  const land = selectApplicableStyleReferences(references, { claim: { business_line: "Land Shipment" }, evidence: landEvidence });
  const unclassified = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: landEvidence });
  const wrongLine = selectApplicableStyleReferences(references, { claim: { business_line: "Air Shipment (NET)" }, evidence: landEvidence });
  const unrelated = selectApplicableStyleReferences(references, { claim: { business_line: "Land Shipment" }, evidence: seaEvidence });

  assert.equal(land.some((item) => item.profile_id === "land-shipments"), true);
  assert.equal(unclassified.some((item) => item.profile_id === "land-shipments"), true);
  assert.equal(wrongLine.some((item) => item.profile_id === "land-shipments"), false);
  assert.equal(unrelated.some((item) => item.profile_id === "land-shipments"), false);
  assert.match(promptText({ business_line: "Land Shipment" }, landEvidence, references), /Land Shipments - Owner-Approved Methodology Profile/);
  assert.doesNotMatch(promptText({ business_line: "Land Shipment" }, seaEvidence, references), /Land Shipments - Owner-Approved Methodology Profile/);
});

test("Land Shipment is a supported AI classification and local fallback detects strong land evidence", async () => {
  assert.equal(BUSINESS_LINES.includes("Land Shipment"), true);
  const result = await createFreeDemoProvider().analyze({
    claim: { business_line: "Unclassified" },
    evidence: [{
      document_id: "cmr-1",
      document_name: "evidence.pdf",
      mime_type: "application/pdf",
      extraction_status: "extracted",
      pages: [{ page: 1, text: "CMR consignment note. Mode of conveyance by land. Truck waybill for road transit." }],
    }],
  });

  assert.equal(result.analysis.classification.business_line, "Land Shipment");
});

test("Land Shipment draft uses its permanent template and includes shipment routing", () => {
  const evidence = [{
    document_id: "land-policy-cmr",
    document_name: "land-evidence.txt",
    mime_type: "text/plain",
    extraction_status: "extracted",
    pages: [{
      page: 1,
      text: "Policy No. LAND-TEST-1. Land transit from Origin City to Destination City. CMR consignment note. Truck Waybill No. TW-100. Shipper: Example Shipper. Consignee: Example Consignee. Commodity: packaged goods.",
    }],
  }];
  const draft = createUnifiedReportDraft({
    claim: { claim_number: "ULA-LAND-TEST", title: "Land transit claim", business_line: "Land Shipment" },
    documents: [{ id: "land-policy-cmr", file_name: "land-evidence.txt", detected_categories: [] }],
    versions: [],
    generatedBy: "Test Preparer",
    evidence,
  });

  assert.equal(draft.template.id, "land-shipment");
  assert.match(draft.content, /## SHIPMENT ROUTING/);
});
