import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRES_CONFIRMATION,
  buildNormalizedClaimRecord,
  createUnifiedReportDraft,
} from "../../src/lib/reportingEngine.js";
import { reportReadiness } from "../../src/lib/reportTemplates.js";
import { loadApprovedStyleReferences } from "../ai/referenceLayer.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");

async function airEvidence() {
  const evidenceDirectory = path.join(root, "samples", "test-evidence", "air-cargo");
  const names = (await fs.readdir(evidenceDirectory)).sort();
  return Promise.all(names.map(async (name, index) => ({
    document_id: `air-${index + 1}`,
    document_name: name,
    mime_type: name.endsWith(".csv") ? "text/csv" : "text/plain",
    extraction_status: "extracted",
    pages: [{ page: null, text: await fs.readFile(path.join(evidenceDirectory, name), "utf8") }],
  })));
}

const documentsFromEvidence = (evidence) => evidence.map((item) => ({
  id: item.document_id,
  file_name: item.document_name,
  detected_categories: [],
  content_analysis_basis: "extracted-text",
}));

test("approved air report structure uses only the new claim evidence and validates the adjustment", async () => {
  const evidence = await airEvidence();
  const claim = {
    claim_number: "ULA-TEST-AIR-001",
    title: "Diagnostic analyzer transit damage",
    business_line: "Air Shipment (NET)",
  };
  const draft = createUnifiedReportDraft({
    claim,
    documents: documentsFromEvidence(evidence),
    versions: [],
    generatedBy: "Test Preparer",
    evidence,
  });

  assert.equal(draft.template.id, "air-shipment");
  assert.equal(draft.normalizedRecord.facts.policy_number.value, "POL-AIR-2026-8812");
  assert.equal(draft.normalizedRecord.facts.air_waybill.value, "774-9821-4402");
  assert.equal(draft.normalizedRecord.financials.currency, "USD");
  assert.equal(draft.normalizedRecord.financials.presented_claim, 42_200);
  assert.equal(draft.normalizedRecord.financials.deductible, 2_500);
  assert.equal(draft.normalizedRecord.financials.concluded_indemnity, 39_700);
  assert.equal(draft.normalizedRecord.financials.arithmetic_valid, true);
  assert.ok(draft.normalizedRecord.chronology.length >= 2);
  assert.ok(draft.normalizedRecord.validation_checks.some((check) => check.id === "cross-document-policy_number" && check.status === "validated"));
  assert.equal(draft.normalizedRecord.cause_assessment.status, "requires_professional_determination");
  assert.ok(draft.normalizedRecord.policy_analysis.entries.some((entry) => entry.topic === "Temperature condition"));
  assert.ok(draft.content.indexOf("## Report Summary") < draft.content.indexOf("## Report and adjustment note"));
  assert.ok(draft.content.indexOf("## SURVEYOR NOTES") < draft.content.indexOf("## CAUSE OF LOSS"));
  assert.ok(draft.content.indexOf("## ADEQUACY OF THE INSURED VALUE") < draft.content.indexOf("## APPOINTMENT OF ASSESSORS"));
  assert.ok(draft.content.indexOf("## CLAIM PRESENTED ON THE POLICY & ADJUSTMENT") < draft.content.indexOf("## CONCLUSION"));
  assert.match(draft.content, /USD 39,700\.00/);
  assert.match(draft.content, /Table 1 - Summary and salient details/);
  assert.match(draft.content, /Description \| Quantity damaged \| Unit Price in USD \| Adjusted Claim Value in USD/);
  assert.doesNotMatch(draft.content, /\| Check \| Status \| Result \|/);
  assert.doesNotMatch(draft.content, /Bechara|HO-MAP-0103552|Gabriele Basilico|12,636\.00|Victoire|Judi Lebanon|MC\/0002606|MSNU7244246|MEDULB209962|13,552\.80/i);
});

test("legacy analyzed reefer claim selects the AI-suggested template and does not invent a quantum", () => {
  const evidence = [{
    document_id: "docs",
    document_name: "Combined evidence.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    pages: [{
      page: 1,
      text: "Policy No. CRG/1404599 Cargo Insurance. Policy Holder: M/s. GLOBAL FOODS SOLUTIONS FZCO. Clause (A) 115,310 1 - Warehouse To Warehouse. Bill of Lading# SSZ1755396. Order or Invoice No. X2600280-2. Commodities 115,310 CHICKEN FEET AB 15KG SEKU9137702. Cargo is stowed in a refrigerated container set at the shipper's requested carrying temperature of -18 degrees Celsius.",
    }, {
      page: 2,
      text: "Policy Holder M/s. GLOBAL FOODS SOLUTIONS FZCO - GFS FZCO (Cont'd...) Cargo Insurance. SUBJECT TO INSTITUTE FROZEN/CHILLED FOOD CLAUSES (A) CL 430.",
    }, {
      page: 5,
      text: "05 CONTAINERS 40' 8831 CARTONS. NET WEIGHT FROZEN CHICKEN FEET 132465,00 KGS. SEAL SIF 298793/SIF2427, 298830/SIF2427. Shipped on Board MAERSK LOTA 31-MAR-2026. SIGNED FOR THE CARRIER CMA CGM S.A.",
    }, {
      page: 6,
      text: "70,206.450 $ Total Currency. Date Invoice # Customer ID 16-Apr-26 X2600280-2 C0024. Invoice : CIF : 31/05/2026 Incoterm. PO# 3204.",
    }, {
      page: 12,
      text: "PELSHIP OFFSHORE S.A.L. Invoice Nbr 3812. Total Price 1,010.00 USD.",
    }, {
      page: 26,
      text: "Statement of facts - Survey date and location: 22 and 23 June 2026 at Consignee's premises. - No temperature data logger was found inside the container at the time of inspection. - Out of 1,767 cartons, 1,669 cartons had quality deterioration and 98 cartons were unfit for human consumption. Appendix A contains representative photographs.",
    }, {
      page: 27,
      text: "Mr Benoni A. Parsons – For ULA As Cargo Insurers Surveyor Without prejudice to Insurers' rights and/or defences.",
    }],
  }];
  const claim = {
    claim_number: "ULA-2026-0001",
    title: "Reefer cargo condition claim",
    business_line: "Unclassified",
    ai_suggested_business_line: "Marine Cargo (Reefer/GFS)",
    ai_analysis_status: "completed",
  };
  const document = {
    id: "docs",
    file_name: "Combined evidence.pdf",
    content_analysis_basis: "ai-content",
    detected_categories: ["Policy", "Bill of Lading", "Survey Report", "Temperature Records"],
  };
  const record = buildNormalizedClaimRecord({ claim, documents: [document], evidence });

  assert.equal(record.template.id, "marine-reefer");
  assert.equal(record.facts.policy_number.value, "CRG/1404599");
  assert.equal(record.facts.insured.value, "M/s. GLOBAL FOODS SOLUTIONS FZCO");
  assert.equal(record.facts.invoice_number.value, "X2600280-2");
  assert.equal(record.facts.freight_invoice_number.value, "3812");
  assert.equal(record.facts.freight_invoice_total.value, "1,010.00");
  assert.equal(record.facts.carrier.value, "CMA CGM S.A.");
  assert.equal(record.facts.surveyor.value, "Benoni A. Parsons");
  assert.equal(record.facts.temperature_requirement.value, "-18 degrees Celsius");
  assert.equal(record.conflicts.length, 0);
  assert.equal(record.financials.presented_claim, null);
  assert.equal(record.financials.invoice_value, 70_206.45);
  assert.equal(record.financials.freight_invoice_value, 1_010);
  assert.equal(record.financials.concluded_indemnity, null);
  assert.ok(record.outstanding_documents.includes("Temperature Records"));

  const draft = createUnifiedReportDraft({ claim, documents: [document], versions: [], generatedBy: "Test", evidence });
  assert.doesNotMatch(draft.content, /USD 0\.00|\$0\.00/);
  assert.match(draft.content, new RegExp(REQUIRES_CONFIRMATION));
  assert.match(draft.content, /Source valuations are not substituted for an absent claim quantum/);
  assert.match(draft.content, /Commercial invoice X2600280-2 records/);
  assert.match(draft.content, /Separate freight invoice 3812 records USD 1,010\.00/);
});

test("layout-aware reefer extraction preserves current-claim policy, invoice, freight, shipment, and survey facts", () => {
  const evidence = [{
    document_id: "docs-current",
    document_name: "DOCS 260643.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    pages: [{
      page: 1,
      text: `Policy No. CRG/1404599 Cargo Insurance
Policy Holder M/s. GLOBAL FOODS SOLUTIONS FZCO - GFS FZCOPN [7553377]
Address FLOOR 8
Inception Date 16/Apr/2026
Total Premium Due USDF 261.00
We, AROPE Insurance (hereinafter called the Company)
1 - Conveyance mode Sea Shipment
2 - Country of Origin Brazil
3 - Port of Origin ITAPOA
4 - Destination Country Liberia
9 - Bill of Lading# SSZ1755396
10 - Order or Invoice No. X2600280-2
14 - Commodities 115,310 CHICKEN FEET AB 15KG
1 - Clause (A) (*) 115,310
A -SPECIAL CONDITIONS :
A1 - SHORTAGE SHOULD BE SUPPORTED BY A CARRIER CERTIFICATE.
A5 - Warranted professionally packed and shipped underdeck.
B -SPECIAL CLAUSES :`,
      raw_text: "Policy Holder M/s. GLOBAL FOODS SOLUTIONS FZCO - GFS FZCOPN [7553377] Cargo Insurance 16/Apr/2026 Inception Date USDF 261.00 Total Premium Due Clause (A) (*) 115,310 1 - Warehouse To Warehouse",
    }, {
      page: 2,
      text: `D -SPECIAL PROVISIONS :
D1 - SUBJECT TO INSTITUTE FROZEN/CHILLED FOOD CLAUSES (A) CL 430 DATED 01/03/2017
- WAREHOUSE TO WAREHOUSE
- WARRANTED CONTAINER IN GOOD CONDITION
- WARRANTED BRAND NEW
- MAXIMUM PER SHIPMENT: USD.2,100,000.-
E - Attachment(s) :`,
    }, {
      page: 3,
      text: "Issued in Beirut in 2 copies on 22/04/2026",
    }, {
      page: 6,
      text: `Date 16-Apr-26
Invoice # X2600280-2
Customer : T.R.H Trading Corporation Incoterm : CIF
Departure :31/03/2026
Arrival Date : 31/05/2026
Total Packages : 8831
FOB $ 39,950.450
Freight $ 30,000.000
Insurance $ 256.000
Total Currency $ 70,206.450`,
      raw_text: "70,206.450 $ Total Currency Date Invoice # Customer ID 16-Apr-26 X2600280-2 C0024",
    }, {
      page: 12,
      text: "Invoice Nbr 3812\nTotal Price USD 1,010.00",
    }, {
      page: 26,
      text: `Statement of facts
- Bill of Lading: SSZ1755396 via MV Maersk Lota.
- Container: 1x40’HC SEKU9137702 STC 1,767 cartons of frozen chicken feet.
- Survey date and location: 22 and 23 June 2026 at Consignee’s premises.
- Survey findings:
- Out of the total shipment of 1,767 cartons, 1,669 cartons were found to have sustained quality deterioration.
- 98 cartons were found to be extensively deteriorated and unfit for human consumption.
All these operations took place in the presence of the parties below.`,
    }],
  }];
  const documents = [{
    id: "docs-current",
    file_name: "DOCS 260643.pdf",
    detected_categories: ["Policy", "Claim Form", "Commercial Invoice", "Bill of Lading", "Survey Report"],
    detected_category_evidence: [
      { category: "Policy", confidence: 1 },
      { category: "Claim Form", confidence: 0 },
      { category: "Commercial Invoice", confidence: 1 },
      { category: "Bill of Lading", confidence: 1 },
      { category: "Survey Report", confidence: 1 },
    ],
  }];
  const claim = {
    claim_number: "ULA-2026-0001",
    title: "Reefer cargo condition claim",
    business_line: "Unclassified",
    ai_suggested_business_line: "Marine Cargo (Reefer/GFS)",
    insured: "Requires confirmation",
    policy_limit: "0.00",
  };

  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test", evidence });
  const record = draft.normalizedRecord;

  assert.equal(record.facts.insured.value, "M/s. GLOBAL FOODS SOLUTIONS FZCO");
  assert.equal(record.facts.insurer.value, "AROPE Insurance");
  assert.equal(record.facts.policy_number.value, "CRG/1404599");
  assert.equal(record.facts.policy_inception_date.value, "16/Apr/2026");
  assert.equal(record.facts.policy_issue_date.value, "22/04/2026");
  assert.equal(record.facts.insured_value.value, "115,310");
  assert.equal(record.facts.policy_limit.value, "115,310");
  assert.equal(record.facts.policy_premium.value, "261.00");
  assert.match(record.facts.warranties_conditions.value, /SHORTAGE SHOULD BE SUPPORTED/);
  assert.match(record.facts.warranties_conditions.value, /WARRANTED CONTAINER IN GOOD CONDITION/);
  assert.equal(record.facts.invoice_total.value, "70,206.450");
  assert.equal(record.facts.freight_amount.value, "30,000.000");
  assert.equal(record.facts.insurance_amount.value, "256.000");
  assert.equal(record.facts.fob_value.value, "39,950.450");
  assert.equal(record.facts.departure_date.value, "31/03/2026");
  assert.equal(record.facts.arrival_date.value, "31/05/2026");
  assert.equal(record.facts.affected_quantity.value, "1,767");
  assert.equal(record.facts.salvage_quantity.value, "1,669");
  assert.equal(record.facts.total_loss_quantity.value, "98");
  assert.equal(record.financials.invoice_value, 70_206.45);
  assert.equal(record.financials.freight_amount, 30_000);
  assert.equal(record.financials.insurance_amount, 256);
  assert.equal(record.financials.fob_value, 39_950.45);
  assert.equal(record.financials.freight_invoice_value, 1_010);
  assert.equal(record.financials.presented_claim, null);
  assert.equal(record.financials.salvage, null);
  assert.equal(record.financials.recovery, null);
  assert.equal(record.facts.policy_period.status, "requires_confirmation");
  assert.equal(record.facts.deductible.status, "requires_confirmation");
  assert.ok(!record.recognized_document_types.includes("Claim Form"));
  assert.deepEqual(record.chronology.map((event) => event.field), [
    "departure_date",
    "invoice_date",
    "policy_inception_date",
    "policy_issue_date",
    "arrival_date",
    "survey_date",
  ]);
  assert.ok(record.validation_checks.some((check) => check.id === "invoice-components" && check.status === "validated"));
  assert.ok(record.validation_checks.some((check) => check.id === "affected-quantity" && check.status === "validated"));
  assert.ok(record.validation_checks.some((check) => check.id === "policy-timing" && check.status === "requires_review"));
  assert.ok(record.policy_analysis.entries.some((entry) => entry.topic === "Packing warranty"));
  assert.ok(record.policy_analysis.entries.some((entry) => entry.topic === "Temperature condition"));
  assert.equal(record.cause_assessment.status, "requires_professional_determination");
  assert.equal(record.document_register[0].categories.includes("Claim Form"), false);
  assert.ok(!draft.readiness.missingFields.includes("insured"));
  assert.ok(!draft.readiness.missingFields.includes("insurer"));
  assert.ok(!draft.readiness.missingFields.includes("policy_number"));
  assert.doesNotMatch(draft.content, /USD 0\.00|\$0\.00/);
  assert.match(draft.content, /freight USD 30,000\.00/);
  assert.match(draft.content, /Insured Value \/ Limit: USD 115,310\.00/);
  assert.match(draft.content, /31\/03\/2026: Cargo departed/);
  assert.match(draft.content, /31\/05\/2026: Cargo arrived/);
  assert.match(draft.content, /FOB, freight, and insurance total USD 70206\.45, matching the commercial invoice total/);
  assert.match(draft.content, /The recorded policy inception \(16\/Apr\/2026\) follows the recorded departure/);
  assert.match(draft.content, /does not establish a definitive proximate cause/);
  assert.doesNotMatch(draft.content, /Victoire|Judi Lebanon|MC\/0002606|MSNU7244246|MEDULB209962|13,552\.80/i);
});

test("a source-stated net amount is not silently reconstructed when adjustment components are absent", () => {
  const analysis = {
    business_line: "Air Shipment (NET)",
    extracted_fields: [
      { field: "currency", value: "USD", normalized_value: "USD", confidence: 1, requires_confirmation: false, sources: [] },
      { field: "gross_claim_amount", value: "10,000", normalized_value: "10,000", confidence: 1, requires_confirmation: false, sources: [] },
      { field: "adjusted_amount", value: "8,000", normalized_value: "8,000", confidence: 1, requires_confirmation: false, sources: [] },
    ],
    document_types: [],
    evidence_findings: [],
  };
  const record = buildNormalizedClaimRecord({ claim: {}, documents: [], analysis, evidence: [] });

  assert.equal(record.financials.concluded_indemnity, 8_000);
  assert.equal(record.financials.arithmetic_valid, false);
  assert.equal(record.financials.calculation_status, "source_stated_requires_reconciliation");
  assert.ok(record.financials.requires_confirmation.includes("Applicable deductible / excess"));
  assert.ok(record.financials.requires_confirmation.includes("Complete adjustment components needed to reconcile the source-stated concluded indemnity"));
});

test("metadata zero placeholders remain unknown unless evidence expressly supports zero", () => {
  const unsupported = buildNormalizedClaimRecord({ claim: { claim_amount: "0.00", deductible: 0 }, documents: [], evidence: [] });
  assert.equal(unsupported.facts.claim_amount.value, null);
  assert.equal(unsupported.facts.deductible.value, null);

  const supported = buildNormalizedClaimRecord({
    claim: { deductible: 0 },
    documents: [],
    evidence: [],
    analysis: {
      business_line: "Air Shipment (NET)",
      extracted_fields: [{
        field: "deductible",
        value: "0",
        normalized_value: "0",
        confidence: 1,
        requires_confirmation: false,
        sources: [{ document_id: "policy", document_name: "Policy.pdf", supporting_text: "No deductible", confidence: 1, evidence_mode: "extracted_text" }],
      }],
      document_types: [],
      evidence_findings: [],
    },
  });
  assert.equal(supported.facts.deductible.value, 0);
});

test("approved sample reference contains presentation guidance only and no historical claim facts", async () => {
  const references = await loadApprovedStyleReferences(path.join(root, "server", "ai", "references"));
  assert.equal(references.length, 1);
  assert.equal(references[0].source_role, "style_reference_only");
  assert.deepEqual(references[0].section_order.slice(0, 5), [
    "Cover Page",
    "Document Control Page",
    "Report Summary",
    "Report and adjustment note",
    "Table 1 - Summary and salient details",
  ]);
  assert.doesNotMatch(JSON.stringify(references), /Bechara|HO-MAP-0103552|Gabriele Basilico|12,636\.00/i);
});

test("conflicting evidence values are retained for human review instead of silently selected", () => {
  const analysis = {
    business_line: "Air Shipment (NET)",
    extracted_fields: [
      { field: "policy_number", normalized_value: "POL-ONE", value: "POL-ONE", confidence: 0.9, requires_confirmation: false, sources: [] },
      { field: "policy_number", normalized_value: "POL-TWO", value: "POL-TWO", confidence: 0.9, requires_confirmation: false, sources: [] },
    ],
    document_types: [],
    evidence_findings: [],
  };
  const record = buildNormalizedClaimRecord({ claim: {}, documents: [], analysis, evidence: [] });
  assert.equal(record.facts.policy_number.value, "POL-ONE");
  assert.equal(record.facts.policy_number.status, "conflict");
  assert.equal(record.conflicts[0].field, "policy_number");
  assert.deepEqual(record.conflicts[0].values, ["POL-ONE", "POL-TWO"]);
  assert.match(record.field_trace.policy_number.resolution, /highest-supported evidence candidate/);
});

test("a claim quantum found on an image-only page is mapped through normalization instead of becoming Requires confirmation", () => {
  const source = {
    document_id: "combined-current",
    document_name: "DOCS 260643.pdf",
    page: 10,
    supporting_text: "Total Claim $ 10,859.57",
    confidence: 0.99,
    evidence_mode: "document_vision",
  };
  const analysis = {
    business_line: "Marine Cargo (Reefer/GFS)",
    extracted_fields: [
      { field: "currency", value: "USD", normalized_value: "USD", confidence: 0.99, requires_confirmation: false, sources: [source] },
      { field: "claim_amount", value: "10,859.57", normalized_value: "10,859.57", confidence: 0.99, requires_confirmation: false, sources: [source] },
      { field: "policy_number", value: "CRG/1404599", normalized_value: "CRG/1404599", confidence: 0.99, requires_confirmation: false, sources: [{ ...source, page: 1, supporting_text: "Policy No. CRG/1404599" }] },
    ],
    adjustment_line_items: [
      { description: "Total damage - 98 cartons", quantity: "98 cartons", unit_price: "11.48", adjusted_value: "1,124.95", currency: "USD", basis: "Cost per carton", confidence: 0.99, sources: [source] },
      { description: "Salvage invoice loss - 574 cartons", quantity: "574 cartons", unit_price: "7.48", adjusted_value: "4,293.52", currency: "USD", basis: "Loss per carton", confidence: 0.99, sources: [source] },
      { description: "Salvage invoice loss - 360 cartons", quantity: "360 cartons", unit_price: "3.48", adjusted_value: "1,252.80", currency: "USD", basis: "Loss per carton", confidence: 0.99, sources: [source] },
      { description: "Salvage invoice loss - 383 cartons", quantity: "383 cartons", unit_price: "4.98", adjusted_value: "1,907.34", currency: "USD", basis: "Loss per carton", confidence: 0.99, sources: [source] },
      { description: "Salvage invoice loss - 352 cartons", quantity: "352 cartons", unit_price: "6.48", adjusted_value: "2,280.96", currency: "USD", basis: "Loss per carton", confidence: 0.99, sources: [source] },
    ],
    document_types: [{ document_type: "Supporting Evidence", sufficient_information: true, sources: [source] }],
    evidence_findings: [],
  };
  const evidence = [{
    document_id: "combined-current",
    document_name: "DOCS 260643.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    searchable_page_count: 1,
    image_only_page_count: 1,
    pages: [{ page: 1, text: "Policy No. CRG/1404599" }, { page: 10, text: "", extraction_status: "image-only" }],
  }];
  const documents = [{ id: "combined-current", file_name: "DOCS 260643.pdf", detected_categories: [] }];
  const claim = { business_line: "Marine Cargo (Reefer/GFS)", claim_amount: "0.00", policy_number: "OLD-METADATA" };

  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test", analysis, evidence });

  assert.equal(draft.normalizedRecord.facts.claim_amount.value, "10,859.57");
  assert.equal(draft.normalizedRecord.facts.gross_claim_amount.value, "10,859.57");
  assert.equal(draft.normalizedRecord.financials.presented_claim, 10_859.57);
  assert.equal(draft.normalizedRecord.financials.itemized_claim_total, 10_859.57);
  assert.equal(draft.normalizedRecord.adjustment.line_items.length, 5);
  assert.ok(draft.normalizedRecord.validation_checks.some((check) => check.id === "claim-schedule-total" && check.status === "validated"));
  assert.equal(draft.normalizedRecord.facts.policy_number.value, "CRG/1404599");
  assert.match(draft.normalizedRecord.field_trace.claim_amount.resolution, /evidence-supported candidate/);
  assert.match(draft.content, /USD 10,859\.57/);
  assert.match(draft.content, /Salvage invoice loss - 574 cartons/);
  assert.doesNotMatch(draft.content, /Requires confirmation/i);
});

test("damaged-goods schedules are reconciled to insured invoice prices instead of producing an empty LBP adjustment", () => {
  const evidence = [{
    document_id: "active-260536",
    document_name: "260536 Documents.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    pages: [{
      page: 1,
      text: `Insured : MM JUDI LEBANON SARL
Policy : 02/MC /2026/0052606/000 N 3297
Effect. : 20/04/2026 Total Premium : 80.00 FUS
Description Sum Insured Rate Deductible
I.C.C. "A" (All risks) 49,771.0 FUS
Means Of Conveyance : MSC ABIDJAN Age :
Supplier : JUDI LEBANON SARL Pack : CON
Goods : Bottled Products, (excluding Beverages)
3434 packages foodstuff BILL MEDULB209962 CONTAINR MSNU7244246`,
    }, {
      page: 3,
      text: `Marine Insurance Certificate
Insured MM JUDI LEBANON SARL
Policy MC/0002606/000 3297
Issuing Date 16/04/2026
Description Sum Insured Deductibles
CL.382 Cargo (A) 49,771 0
Total Sum Insured: FUS$ 49,771
Shipping Date 20/04/2026
Goods Type Bottled Products, (excluding Beverages) City LONDONGATEWAY`,
    }, {
      page: 6,
      text: `JUDI LEBANON S.A.R.L
Sales Invoice
Customer Name: Damasgate Wholesale Invoice #: 53
Date: 14/04/2026 Currency: $
Unit Per
Item# Description Quantity Unit Price Total Amount
Box
1 Mixed Pickles 1300G Box(6) 100 $10.00 $ 1,000.00
2 Cucumber Pickles 1300G Box(6) 96 $12.50 $ 1,200.00
3 Wild Cucumber Pickles 1300G Box(6) 192 $12.50 $ 2,400.00
4 Stuffed Eggplant 600G Box(6) 169 $15.00 $ 2,535.00
5 Orange Blossom Water 250ML Box(12) 84 $8.00 $ 672.00
6 Rose Water 250ML Box(12) 84 $8.00 $ 672.00
7 Rose Water 500ML Box(12) 114 $12.00 $ 1,368.00
8 Apple Vinegar 500ML Box(12) 114 $13.00 $ 1,482.00
9 Green Olives Halabi 1250G Box(6) 190 $18.50 $ 3,515.00
10 Green Olives Salqini 1250G Box(6) 197 $22.00 $ 4,334.00
11 Amba Mild Sauce 450G Box(8) 292 $9.00 $ 2,628.00
12 Amba Hot Sauce 450G Box(8) 292 $9.00 $ 2,628.00
13 Beet Pickles Fresh Pack 370G Box(12) 240 $9.00 $ 2,160.00
14 Garlic Pickles 600G Box(6) 260 $14.00 $ 3,640.00
15 Red Vinegar 1L Box(12) 240 $12.03 $ 2,887.20
16 Hot Pepper Paste With Seeds 640G Box(6) 260 $17.50 $ 4,550.00
17 Green Olives Salqini 600G Box(6) 260 $22.50 $ 5,850.00
18 Okra with oil 450G Box(12) 250 $25.00 $ 6,250.00
Sub-Total 49771
Total Quantity: 3434 Box Discount 0
Net Total 49771
LBP 0.00 V.A.T 0% 0
Net to Pay 49771`,
    }, {
      page: 13,
      text: `damaged goods count
Product Name Boxes Packing item price $ total
£1.20 PICKLED BEETROOT 370G 40 12 16 640
£1.20 RED VINEGAR 1L 60 12 12 720
£1.50 ORANGE BLOSSOM WATER 250ML 72 12 14 1008
£1.99 MANGO SAUCE (AMBA) 450G 80 8 16 1280
£1.99 MANGO SAUCE HOT (AMBA) 450G 80 8 16 1280
£2.00 APPLE VINEGAR 500ML 60 12 19 1140
£2.00 HOT PEPPER PASTE 640G 40 6 13.5 540
£2.00 ROSE WATER 500ML 60 12 17 1020
£2.50 OKRA WITH OIL 450G 80 12 13.5 1080
£3.25 MIXED 1300G 40 6 16 640
£3.30 GREEN OLIVES BALADI 600G 70 6 16 1120
£3.50 WILD CUCUMBER 1300G 80 6 17 1360
£3.75 PICKLED GARLIC 600g 40 6 22 880
£3.89 CUCUMBER PICKLE 1300G 40 6 16 640
£3.95 EGGPLANT (MAKDOUS) HOT 400G WITHOUT OIL 40 6 16 640
£4.99 1250G GREEN OLIVES HALABI 40 6 26 1040
£5.99 1250G GREEN OLIVES BALADI 40 6 26 1040
total damage 16068`,
    }],
  }];
  const documents = [{ id: "active-260536", file_name: "260536 Documents.pdf", detected_categories: [] }];
  const claim = { claim_number: "ULA-260536", title: "Bottled products transit damage", business_line: "Marine Cargo (Non-Reefer)" };

  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test", evidence });
  const record = draft.normalizedRecord;

  assert.equal(record.facts.invoice_number.value, "53");
  assert.equal(record.facts.invoice_total.value, "49771");
  assert.equal(record.facts.claim_amount.value, "16068");
  assert.equal(record.facts.affected_quantity.value, "962");
  assert.equal(record.financials.currency, "USD");
  assert.equal(record.financials.presented_claim, 16_068);
  assert.equal(record.financials.adjusted_claim_amount, 13_552.8);
  assert.equal(record.financials.valuation_adjustment, 2_515.2);
  assert.equal(record.financials.deductible, 0);
  assert.equal(record.financials.concluded_indemnity, 13_552.8);
  assert.equal(record.financials.arithmetic_valid, true);
  assert.equal(record.adjustment.line_items.length, 17);
  assert.equal(record.adjustment.line_items[0].unit_price, 9);
  assert.equal(record.adjustment.line_items[0].adjusted_value, 360);
  assert.match(draft.content, /gross claim of USD 16,068\.00/i);
  assert.match(draft.content, /adjusted claim amount of USD 13,552\.80/i);
  assert.match(draft.content, /Adjusted Claim Amount.*USD 13,552\.80/s);
  assert.doesNotMatch(draft.content, /evidence supporting 53/i);
  assert.doesNotMatch(draft.content, /LBP 0\.00/i);
});

test("template readiness counts normalized evidence facts and analyzed document types instead of raw claim fields only", () => {
  const requiredValues = {
    claim_number: "ULA-2026-0001",
    title: "Reefer cargo condition claim",
    business_line: "Marine Cargo (Reefer/GFS)",
    insured: "Global Foods Solutions FZCO",
    insurer: "AROPE Insurance",
    broker: "Evidence Broker",
    policy_number: "CRG/1404599",
    date_of_loss: "22 June 2026",
    date_of_intimation: "22 June 2026",
    country: "Liberia",
    claim_amount: "10,859.57",
    deductible: "500",
    cause_of_loss: "Evidence-stated transit temperature excursion",
    shipper: "Nutriza Agroindustrial",
    consignee: "TRH Trading Corporation",
    bill_of_lading: "SSZ1755396",
    commodity: "Frozen chicken feet",
    vessel_name: "MAERSK LOTA",
    port_of_loading: "ITAPOA",
    port_of_discharge: "MONROVIA",
  };
  const source = [{ document_id: "combined", document_name: "combined.pdf", page: 1 }];
  const claim = {
    business_line: "Unclassified",
    ai_suggested_business_line: "Marine Cargo (Reefer/GFS)",
    claim_amount: "0.00",
    normalized_claim_record: {
      facts: Object.fromEntries(Object.entries(requiredValues).map(([field, value]) => [field, { value, status: "supported", sources: source }])),
    },
    ai_analysis: {
      suggested_claim_data: requiredValues,
      document_types: ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Report"]
        .map((document_type) => ({ document_type, sufficient_information: true })),
    },
  };

  const readiness = reportReadiness(claim, []);
  assert.equal(readiness.overallProgress, 100);
  assert.deepEqual(readiness.missingFields, []);
  assert.deepEqual(readiness.missingDocuments, []);
});
