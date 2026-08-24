import fs from "node:fs";

const paidRequestFile = (name) => fs.readFileSync(
  new URL(`../../../samples/test-evidence/air-cargo/${name}`, import.meta.url),
  "utf8",
).trim();

export const multiDocumentEvidenceFixture = [
  {
    document_id: "policy-1",
    document_name: "uploaded-document-a.txt",
    mime_type: "text/plain",
    kind: "text",
    extraction_status: "extracted",
    pages: [{
      page: null,
      text: "OPEN CARGO AND AIR TRANSIT INSURANCE POLICY\nPolicy Number: POL-AIR-2026-8812\nInsured: Example Trading SAL",
    }],
  },
  {
    document_id: "claim-form-2",
    document_name: "uploaded-document-b.txt",
    mime_type: "text/plain",
    kind: "text",
    extraction_status: "extracted",
    pages: [{
      page: null,
      text: "NOTICE OF CARGO CLAIM AND CLAIM DECLARATION FORM\nDate of Loss: 12 March 2026\nClaimant signature: Example Trading SAL",
    }],
  },
  {
    document_id: "survey-3",
    document_name: "uploaded-document-c.txt",
    mime_type: "text/plain",
    kind: "text",
    extraction_status: "extracted",
    pages: [{
      page: null,
      text: "PRELIMINARY ATTENDANCE AND SURVEY REPORT\nPhysical shock indicators on Crates #2 and #3 were activated.",
    }],
  },
];

const source = (documentId, documentName, supportingText, confidence = 0.96) => ({
  document_id: documentId,
  document_name: documentName,
  page: null,
  supporting_text: supportingText,
  confidence,
  evidence_mode: "extracted_text",
});

export const validAnthropicAnalysisFixture = {
  classification: {
    business_line: "Air Shipment (NET)",
    confidence: 0.94,
    rationale: "The policy, claim declaration, and survey describe an insured air-cargo transit loss.",
    sources: [source(
      "policy-1",
      "uploaded-document-a.txt",
      "OPEN CARGO AND AIR TRANSIT INSURANCE POLICY",
      0.94,
    )],
  },
  document_types: [
    {
      document_type: "Policy",
      confidence: 0.98,
      sufficient_information: true,
      rationale: "The content identifies an insurance policy and policy number.",
      sources: [source("policy-1", "uploaded-document-a.txt", "Policy Number: POL-AIR-2026-8812", 0.98)],
    },
    {
      document_type: "Claim Form",
      confidence: 0.97,
      sufficient_information: true,
      rationale: "The content is a signed claim declaration with a loss date.",
      sources: [source(
        "claim-form-2",
        "uploaded-document-b.txt",
        "NOTICE OF CARGO CLAIM AND CLAIM DECLARATION FORM",
        0.97,
      )],
    },
    {
      document_type: "Survey Report",
      confidence: 0.96,
      sufficient_information: true,
      rationale: "The report records physical damage observations.",
      sources: [source(
        "survey-3",
        "uploaded-document-c.txt",
        "Physical shock indicators on Crates #2 and #3 were activated.",
      )],
    },
  ],
  fields: [
    {
      field: "insured",
      value: "Example Trading SAL",
      normalized_value: "Example Trading SAL",
      confidence: 0.98,
      requires_confirmation: false,
      sources: [source("policy-1", "uploaded-document-a.txt", "Insured: Example Trading SAL", 0.98)],
    },
    {
      field: "date_of_loss",
      value: "12 March 2026",
      normalized_value: "2026-03-12",
      confidence: 0.97,
      requires_confirmation: false,
      sources: [source("claim-form-2", "uploaded-document-b.txt", "Date of Loss: 12 March 2026", 0.97)],
    },
    {
      field: "claim_amount",
      value: null,
      normalized_value: null,
      confidence: 0,
      requires_confirmation: true,
      sources: [],
    },
  ],
  adjustment_line_items: [],
  missing_documents: [],
  evidence_findings: [{
    finding: "The survey records activated shock indicators on two crates.",
    confidence: 0.96,
    sources: [source(
      "survey-3",
      "uploaded-document-c.txt",
      "Physical shock indicators on Crates #2 and #3 were activated.",
    )],
  }],
  summary: "The uploaded policy, claim declaration, and survey support an air-shipment claim classification.",
  warnings: [],
  human_review_required: ["Coverage and quantum require human review."],
};

export function canonicalAnalysisToAnthropicTransportFixture(analysis) {
  const sources = [];
  const sourceIndexes = new Map();
  const refs = (items = []) => items.map((item) => {
    const transportSource = { ...item, page: item.page ?? 0 };
    const key = JSON.stringify(transportSource);
    if (!sourceIndexes.has(key)) {
      sourceIndexes.set(key, sources.length);
      sources.push(transportSource);
    }
    return sourceIndexes.get(key);
  });
  const record = (kind, values = {}) => ({
    kind,
    key: "",
    value: "",
    normalized_value: "",
    text: "",
    quantity: "",
    unit_price: "",
    currency: "",
    basis: "",
    confidence: 0,
    flag: false,
    source_refs: [],
    details: [],
    ...values,
  });
  const records = [];
  if (analysis.classification) records.push(record("classification", {
    key: analysis.classification.business_line,
    text: analysis.classification.rationale,
    confidence: analysis.classification.confidence,
    source_refs: refs(analysis.classification.sources),
  }));
  for (const item of analysis.document_types || []) records.push(record("document_type", {
    key: item.document_type, text: item.rationale, confidence: item.confidence,
    flag: item.sufficient_information, source_refs: refs(item.sources),
  }));
  for (const item of (analysis.fields || []).filter((field) => field.value !== null)) records.push(record("field", {
    key: item.field, value: item.value ?? "", normalized_value: item.normalized_value ?? "",
    confidence: item.confidence, flag: item.requires_confirmation, source_refs: refs(item.sources),
  }));
  for (const item of analysis.adjustment_line_items || []) records.push(record("adjustment", {
    text: item.description, quantity: item.quantity ?? "", unit_price: item.unit_price ?? "",
    value: item.adjusted_value, currency: item.currency ?? "", basis: item.basis,
    confidence: item.confidence, source_refs: refs(item.sources),
  }));
  for (const item of analysis.missing_documents || []) records.push(record("missing_document", {
    key: item.document_type, text: item.reason, details: item.missing_information,
  }));
  for (const item of analysis.evidence_findings || []) records.push(record("finding", {
    text: item.finding, confidence: item.confidence, source_refs: refs(item.sources),
  }));
  if (typeof analysis.summary === "string") records.push(record("summary", { text: analysis.summary }));
  for (const item of analysis.warnings || []) records.push(record("warning", { text: item }));
  for (const item of analysis.human_review_required || []) records.push(record("review", { text: item }));
  return { sources, records };
}

export const anthropicMessageFixture = (analysis = validAnthropicAnalysisFixture, overrides = {}) => ({
  id: "msg_mock_structured",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  content: [{
    type: "text",
    text: JSON.stringify(canonicalAnalysisToAnthropicTransportFixture(analysis)),
  }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 900 },
  ...overrides,
});

export const paidRequestEvidenceFixture = [
  ["1b20cadd-b3e7-4372-af43-3676d0fcd0e9", "01_Air_Waybill_AWB-774-9821.txt", "text/plain"],
  ["77065dbc-57a1-4656-ba19-2fed39730d0b", "02_Commercial_Invoice_INV-2026-991.txt", "text/plain"],
  ["ee0bc522-c162-4a4d-9e67-4ee9d3fb4a58", "03_Packing_List_PL-2026-991.csv", "text/csv"],
  ["ffa50153-931d-4d42-8add-e1ce9b6dd6bf", "03_Preliminary_Survey_Report.txt", "text/plain"],
  ["8b758cca-1b9b-41b2-ac94-010fc1993c14", "04_Marine_Air_Transit_Policy_POL-2026-8812.txt", "text/plain"],
  ["f9c058ed-899e-44d7-858a-fee5951adcc7", "05_Notice_of_Claim_Form.txt", "text/plain"],
].map(([documentId, documentName, mimeType]) => ({
  document_id: documentId,
  document_name: documentName,
  mime_type: mimeType,
  kind: "text",
  extraction_status: "extracted",
  pages: [{ page: null, text: paidRequestFile(documentName) }],
}));

const paidSource = (index, supportingText, confidence = 0.96) => ({
  document_id: paidRequestEvidenceFixture[index].document_id,
  document_name: paidRequestEvidenceFixture[index].document_name,
  page: null,
  supporting_text: supportingText,
  confidence,
  evidence_mode: "extracted_text",
});

export const paidRequestZeroPercentClaudeFixture = {
  classification: {
    business_line: "Air Shipment (NET)",
    confidence: 0.97,
    rationale: "The complete evidence set concerns insured air cargo transported from Frankfurt to Beirut.",
    sources: [paidSource(
      0,
      "Air shipment 774-9821-4402 carried temperature-controlled medical analyzers from Frankfurt to Beirut under the transit policy.",
      0.97,
    )],
  },
  document_types: [
    {
      document_type: "Air Waybill",
      confidence: 0.99,
      sufficient_information: true,
      rationale: "The document identifies the airway bill, route, shipper, consignee, carrier, and cargo.",
      sources: [paidSource(0, "Air waybill 774-9821-4402 from Frankfurt to Beirut for temperature controlled medical sensors", 0.99)],
    },
    {
      document_type: "Commercial Invoice",
      confidence: 0.99,
      sufficient_information: true,
      rationale: "The invoice identifies the parties and invoiced goods.",
      sources: [paidSource(1, "Commercial invoice INV-2026-991 dated 08 March 2026 sold by BioTech Precision Instruments", 0.99)],
    },
    {
      document_type: "Packing List",
      confidence: 0.98,
      sufficient_information: true,
      rationale: "The CSV itemizes four crates and their weights.",
      sources: [paidSource(2, "Packing list item Crate 2/4 Precision Analyzer X4-9082 gross weight 85.0 kg", 0.98)],
    },
    {
      document_type: "Survey Report",
      confidence: 0.99,
      sufficient_information: true,
      rationale: "The survey records physical and temperature damage findings.",
      sources: [paidSource(3, "Physical shock indicators on Crates 2 and 3 were activated", 0.99)],
    },
    {
      document_type: "Policy",
      confidence: 0.99,
      sufficient_information: true,
      rationale: "The policy identifies air-transit coverage, the insured, limit, and deductible.",
      sources: [paidSource(
        4,
        "Open cargo air transit policy POL-AIR-2026-8812 insured Levant Medical Supplies and covers temperature excursion",
        0.99,
      )],
    },
    {
      document_type: "Claim Form",
      confidence: 0.99,
      sufficient_information: true,
      rationale: "The notice contains a claim declaration, claimant, policy reference, loss date, cause, and amount.",
      sources: [paidSource(
        5,
        "Cargo claim declaration for Levant Medical Supplies policy POL-AIR-2026-8812 loss 12 March 2026",
        0.99,
      )],
    },
  ],
  fields: [],
  adjustment_line_items: [],
  missing_documents: [
    { document_type: "Policy", reason: "Not confirmed", missing_information: ["Policy"] },
    { document_type: "Claim Form", reason: "Not confirmed", missing_information: ["Claim Form"] },
    { document_type: "Supporting Evidence", reason: "Not confirmed", missing_information: ["Supporting Evidence"] },
  ],
  evidence_findings: [],
  summary: "The uploaded documents substantiate an air-cargo claim requiring human review.",
  warnings: [],
  human_review_required: ["Coverage, causation, and quantum require professional review."],
};
