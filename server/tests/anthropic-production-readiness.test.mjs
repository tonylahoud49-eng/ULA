import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createAnthropicProvider, anthropicProviderInternals } from "../ai/providers/anthropicProvider.mjs";
import { prepareClaimContextForAnthropic } from "../evidence/prepareAnthropicEvidence.mjs";
import { mapAnalysis } from "../../src/api/aiAnalysisClient.js";
import { createUnifiedReportDraft } from "../../src/lib/reportingEngine.js";
import { populateMasterReportDocx } from "../../src/lib/masterReportDocx.js";
import {
  anthropicMessageFixture,
  canonicalAnalysisToAnthropicTransportFixture,
  paidRequestEvidenceFixture,
} from "./fixtures/anthropicResponses.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");

const source = (index, supportingText, confidence = 0.97) => ({
  document_id: paidRequestEvidenceFixture[index].document_id,
  document_name: paidRequestEvidenceFixture[index].document_name,
  page: null,
  supporting_text: supportingText,
  confidence,
  evidence_mode: "extracted_text",
});

const field = (name, value, normalizedValue, evidenceSource, confidence = 0.96) => ({
  field: name,
  value,
  normalized_value: normalizedValue,
  confidence,
  requires_confirmation: false,
  sources: [evidenceSource],
});

function currentClaimMockAnalysis() {
  const surveySource = source(3, "Net Concluded Payable Quantum: USD 39,700.00");
  return {
    classification: {
      business_line: "Air Shipment (NET)",
      confidence: 0.98,
      rationale: "The evidence documents insured air cargo transported from Frankfurt to Beirut.",
      sources: [source(0, "AIR WAYBILL / LETTRE DE TRANSPORT AERIEN"), source(4, "OPEN CARGO & AIR TRANSIT INSURANCE POLICY")],
    },
    document_types: [
      ["Air Waybill", 0, "AWB Number: 774-9821-4402"],
      ["Commercial Invoice", 1, "Total Commercial Value: USD 118,500.00"],
      ["Packing List", 2, "Total,4 Wooden Crates,,300.0,340.0,"],
      ["Survey Report", 3, "PRELIMINARY ATTENDANCE & SURVEY REPORT"],
      ["Policy", 4, "Policy Number: POL-AIR-2026-8812"],
      ["Claim Form", 5, "NOTICE OF CARGO CLAIM & CLAIM DECLARATION FORM"],
      ["Supporting Evidence", 3, "Technical calibration testing indicates Unit #2 is beyond economical repair (Total Loss)."],
    ].map(([documentType, index, excerpt]) => ({
      document_type: documentType,
      confidence: 0.97,
      sufficient_information: true,
      rationale: `The uploaded evidence contains substantive ${documentType} information.`,
      sources: [source(index, excerpt)],
    })),
    fields: [
      field("insured", "Levant Medical Supplies SAL", "Levant Medical Supplies SAL", source(4, "Assured / Insured: Levant Medical Supplies SAL")),
      field("insurer", "Lia Assurex SAL", "Lia Assurex SAL", source(4, "Insurer: Lia Assurex SAL, Beirut, Lebanon")),
      field("broker", "Aon Middle East Insurance Brokers Ltd", "Aon Middle East Insurance Brokers Ltd", source(4, "Broker: Aon Middle East Insurance Brokers Ltd")),
      field("policy_number", "POL-AIR-2026-8812", "POL-AIR-2026-8812", source(4, "Policy Number: POL-AIR-2026-8812")),
      field("policy_period", "01 January 2026 to 31 December 2026", "01 January 2026 to 31 December 2026", source(4, "Period of Insurance: 01 January 2026 to 31 December 2026")),
      field("policy_limit", "USD 250,000.00", "250000", source(4, "Conveyance / Limits: Any one Air Shipment up to USD 250,000.00")),
      field("policy_terms", "Institute Cargo Clauses (Air); temperature excursion subject to logger verification", null, source(4, "Conditions: Including temperature excursion coverage (+2C to +8C) subject to logger verification.")),
      field("deductible", "USD 2,500.00", "2500", source(4, "Deductible / Excess: USD 2,500.00 each and every loss.")),
      field("currency", "USD", "USD", source(1, "Total Commercial Value: USD 118,500.00")),
      field("invoice_total", "USD 118,500.00", "118500", source(1, "Total Commercial Value: USD 118,500.00")),
      field("claim_amount", "USD 39,700.00", "39700", source(5, "Claimed Amount: USD 39,700.00 (Total Loss of Unit #2 + Technical Calibration less deductible)")),
      field("adjusted_amount", "USD 39,700.00", "39700", surveySource),
      field("air_waybill", "774-9821-4402", "774-9821-4402", source(0, "AWB Number: 774-9821-4402")),
      field("shipper", "BioTech Precision Instruments GmbH", "BioTech Precision Instruments GmbH", source(0, "Shipper: BioTech Precision Instruments GmbH, Frankfurt, Germany")),
      field("consignee", "Levant Medical Supplies SAL", "Levant Medical Supplies SAL", source(0, "Consignee: Levant Medical Supplies SAL, Beirut, Lebanon")),
      field("carrier", "SkyFreight Cargo Airlines", "SkyFreight Cargo Airlines", source(0, "Carrier: SkyFreight Cargo Airlines (Flight SF-802)")),
      field("commodity", "4 Crates Temperature-Sensitive Diagnostic Analyzers", "4 Crates Temperature-Sensitive Diagnostic Analyzers", source(0, "Commodity: 4 Crates Temperature-Sensitive Diagnostic Analyzers")),
      field("gross_weight", "340.0 kg", "340.0 kg", source(0, "Gross Weight: 340.0 kg | Declared Value for Carriage: USD 118,500.00")),
      field("date_of_loss", "12 March 2026", "2026-03-12", source(5, "Date of Loss / Flight Arrival: 12 March 2026")),
      field("cause_of_loss", "Physical impact shock and tarmac temperature excursion", null, source(5, "Nature of Loss: Severe physical impact shock and tarmac temperature excursion damaging Precision Analyzer Unit #2 during transit."), 0.9),
      field("temperature_requirement", "+2C to +8C", "+2C to +8C", source(0, "Handling Info: TEMPERATURE CONTROLLED (+2C to +8C). CRITICAL MEDICAL SENSORS.")),
      field("temperature_findings", "+28.4C for 6 hours", "+28.4C for 6 hours", source(3, "Cold chain temperature data logger recorded temperature excursion to +28.4C for 6 hours due to delayed tarmac transfer.")),
      field("damage_findings", "Analyzer Unit #2 was beyond economical repair", null, source(3, "Technical calibration testing indicates Unit #2 is beyond economical repair (Total Loss).")),
      field("survey_date", "14 March 2026", "2026-03-14", source(3, "Date of Attendance: 14 March 2026")),
      field("survey_location", "Cargo Handling Facility, Beirut Airport Freight Terminal", null, source(3, "Location: Cargo Handling Facility, Beirut Airport Freight Terminal")),
      field("claim_basis", "Total loss of Unit #2 plus recalibration and inspection less deductible", null, source(5, "Claimed Amount: USD 39,700.00 (Total Loss of Unit #2 + Technical Calibration less deductible)")),
    ],
    adjustment_line_items: [
      {
        description: "Total Loss Unit #2",
        quantity: "1 unit",
        unit_price: "USD 38,000.00",
        adjusted_value: "USD 38,000.00",
        currency: "USD",
        basis: "Survey recommended quantum adjustment",
        confidence: 0.98,
        sources: [source(3, "Total Loss Unit #2: USD 38,000.00")],
      },
      {
        description: "Recalibration & Inspection Cost",
        quantity: null,
        unit_price: null,
        adjusted_value: "USD 4,200.00",
        currency: "USD",
        basis: "Survey recommended quantum adjustment",
        confidence: 0.98,
        sources: [source(3, "Recalibration & Inspection Cost: USD 4,200.00")],
      },
    ],
    missing_documents: [],
    evidence_findings: [
      { finding: "Shock indicators on crates 2 and 3 were activated.", confidence: 0.97, sources: [source(3, "Physical shock indicators on Crates #2 and #3 were activated (red latch tripped > 25G impact).") ] },
      { finding: "Unit 2 was assessed as beyond economical repair.", confidence: 0.97, sources: [source(3, "Technical calibration testing indicates Unit #2 is beyond economical repair (Total Loss).") ] },
      { finding: "The logger recorded +28.4C for six hours.", confidence: 0.97, sources: [source(3, "Cold chain temperature data logger recorded temperature excursion to +28.4C for 6 hours due to delayed tarmac transfer.") ] },
    ],
    summary: "The evidence supports an air-cargo damage claim with a source-stated net quantum of USD 39,700.",
    warnings: ["Coverage and proximate cause remain subject to professional review."],
    human_review_required: ["Review coverage, causation, liability, quantum, salvage, and recovery before issue."],
  };
}

function exactPaidFailureTransportFixture() {
  const transport = canonicalAnalysisToAnthropicTransportFixture(currentClaimMockAnalysis());
  const usedFields = {
    classification: new Set(["kind", "key", "text", "confidence", "source_refs"]),
    document_type: new Set(["kind", "key", "text", "confidence", "flag", "source_refs"]),
    field: new Set(["kind", "key", "value", "normalized_value", "confidence", "flag", "source_refs"]),
    adjustment: new Set(["kind", "value", "text", "quantity", "unit_price", "currency", "basis", "confidence", "source_refs"]),
    missing_document: new Set(["kind", "key", "text", "details"]),
    finding: new Set(["kind", "text", "confidence", "source_refs"]),
    summary: new Set(["kind", "text"]),
    warning: new Set(["kind", "text"]),
    review: new Set(["kind", "text"]),
  };
  const nullableSlots = [
    "key", "value", "normalized_value", "text", "quantity", "unit_price", "currency", "basis",
    "confidence", "flag", "source_refs", "details",
  ];

  for (const sourceRecord of transport.sources) {
    if (sourceRecord.page === 0) sourceRecord.page = null;
  }
  for (const record of transport.records) {
    for (const slot of nullableSlots) {
      if (!usedFields[record.kind].has(slot)) record[slot] = null;
    }
    // These used transport slots represent nullable canonical values.
    for (const slot of ["value", "normalized_value", "quantity", "unit_price", "currency"]) {
      if (record[slot] === "") record[slot] = null;
    }
  }
  return transport;
}

function legacyUnusedSlotFailures(transport) {
  const usedFields = {
    classification: new Set(["kind", "key", "text", "confidence", "source_refs"]),
    document_type: new Set(["kind", "key", "text", "confidence", "flag", "source_refs"]),
    field: new Set(["kind", "key", "value", "normalized_value", "confidence", "flag", "source_refs"]),
    adjustment: new Set(["kind", "value", "text", "quantity", "unit_price", "currency", "basis", "confidence", "source_refs"]),
    missing_document: new Set(["kind", "key", "text", "details"]),
    finding: new Set(["kind", "text", "confidence", "source_refs"]),
    summary: new Set(["kind", "text"]),
    warning: new Set(["kind", "text"]),
    review: new Set(["kind", "text"]),
  };
  const wasAcceptedEmptyDefault = (value) => value === "" || value === 0 || value === false
    || (Array.isArray(value) && value.length === 0);
  return transport.records.flatMap((record, recordIndex) => Object.entries(record).flatMap(([fieldName, value]) =>
    !usedFields[record.kind].has(fieldName) && !wasAcceptedEmptyDefault(value)
      ? [`records.${recordIndex}.${fieldName}`]
      : []));
}

const textOf = (xml) => [...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1])
  .join("")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

test("application mapping recognizes both normalized and already-percent confidence values", () => {
  const normalized = currentClaimMockAnalysis();
  normalized.classification.confidence = 0.98;
  normalized.classification.sources[0].confidence = 0.92;
  const normalizedMapped = mapAnalysis({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    analysis: normalized,
  });
  assert.equal(normalizedMapped.confidence, 98);
  assert.equal(normalizedMapped.evidence_sources[0].confidence, "92% AI confidence");
  assert.ok(normalizedMapped.evidence_sources.some((item) => item.field.startsWith("Analysis: ")));
  assert.ok(normalizedMapped.evidence_sources.some((item) => item.field.startsWith("Adjustment item ")));

  const percent = structuredClone(normalized);
  percent.classification.confidence = "98%";
  percent.classification.sources[0].confidence = 92;
  const percentMapped = mapAnalysis({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    analysis: percent,
  });
  assert.equal(percentMapped.confidence, 98);
  assert.equal(percentMapped.evidence_sources[0].confidence, "92% AI confidence");
});

test("current six-document claim completes mocked Anthropic-to-DOCX production pipeline with one provider request", async () => {
  let providerCalls = 0;
  let requestUrl;
  let requestOptions;
  let requestBody;
  const provider = createAnthropicProvider({
    apiKey: "mock-audit-key",
    model: "claude-sonnet-4-6",
    maxOutputTokens: 12_000,
    fetchImpl: async (url, options) => {
      providerCalls += 1;
      requestUrl = url;
      requestOptions = options;
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(anthropicMessageFixture(currentClaimMockAnalysis())), {
        status: 200,
        headers: { "request-id": "req_offline_readiness" },
      });
    },
  });
  const files = paidRequestEvidenceFixture.map((item) => ({
    mimetype: item.mime_type,
    buffer: Buffer.from(item.pages[0].text),
  }));
  const providerResult = await provider.analyze({
    claim: { id: "current-air-claim", claim_number: "ULA-AUDIT-001", title: "Diagnostic analyzer transit damage", claim_amount: 0 },
    evidence: paidRequestEvidenceFixture,
    files,
  });
  const mapped = mapAnalysis({ ...providerResult, evidence_snapshot: paidRequestEvidenceFixture });
  const claim = {
    id: "current-air-claim",
    claim_number: "ULA-AUDIT-001",
    title: "Diagnostic analyzer transit damage",
    business_line: "Unclassified",
    claim_amount: 0,
    ai_suggested_business_line: mapped.business_line,
    ai_analysis: mapped,
  };
  const documents = paidRequestEvidenceFixture.map((item) => ({
    id: item.document_id,
    file_name: item.document_name,
    detected_categories: [],
  }));
  const draft = createUnifiedReportDraft({
    claim,
    documents,
    versions: [],
    generatedBy: "Offline Audit",
    analysis: mapped,
    evidence: paidRequestEvidenceFixture,
  });

  assert.equal(providerCalls, 1);
  assert.equal(requestUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers["content-type"], "application/json");
  assert.equal(requestOptions.headers["anthropic-version"], "2023-06-01");
  assert.equal(requestOptions.headers["x-api-key"], "mock-audit-key");
  assert.equal(requestBody.model, "claude-sonnet-4-6");
  assert.equal(requestBody.max_tokens, 12_000);
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.tools, undefined);
  assert.deepEqual(requestBody.thinking, { type: "enabled", budget_tokens: 2_500 });
  assert.equal(requestBody.output_config.effort, undefined);
  assert.equal(requestBody.output_config.format.type, "json_schema");
  assert.deepEqual(requestBody.output_config.format.schema, anthropicProviderInternals.structuredOutputSchema());
  assert.doesNotMatch(JSON.stringify(requestBody.output_config.format.schema), /maxItems/);
  assert.match(requestBody.system, /Claude loss-adjuster decision workflow/i);
  assert.match(requestBody.system, /develop the viable causal hypotheses, test each against custody, physical consistency, contemporaneous records/i);
  assert.match(requestBody.system, /Apply the actual current policy issue by issue/i);
  assert.match(requestBody.system, /conduct an adversarial senior-review audit/i);
  assert.match(requestBody.messages[0].content.at(-1).text, /Use the bounded thinking budget efficiently.*reserve the remaining output budget/is);
  assert.equal(draft.normalizedRecord.financials.presented_claim, 42_200);
  assert.notEqual(draft.normalizedRecord.financials.presented_claim, 0);
  assert.equal(draft.normalizedRecord.financials.concluded_indemnity, 39_700);
  assert.equal(draft.normalizedRecord.facts.salvage_amount.value, null);
  assert.equal(draft.normalizedRecord.facts.recovery_amount.value, null);
  assert.equal(draft.normalizedRecord.document_register.length, 6);
  assert.ok(draft.normalizedRecord.evidence_findings.every((item) => Array.isArray(item.sources)));
  for (const heading of ["Report Summary", "Cause of Loss", "Claim Presented", "Outstanding", "Enclosure"]) {
    assert.match(draft.content, new RegExp(heading, "i"));
  }

  const stressAnalysis = {
    ...mapped,
    evidence_findings: Array.from({ length: 80 }, (_, index) => ({
      ...mapped.evidence_findings[index % mapped.evidence_findings.length],
      finding: `${mapped.evidence_findings[index % mapped.evidence_findings.length].finding} Render row ${index + 1}.`,
    })),
  };
  const stressDraft = createUnifiedReportDraft({
    claim: { ...claim, ai_analysis: stressAnalysis },
    documents,
    versions: [],
    generatedBy: "Offline Audit",
    analysis: stressAnalysis,
    evidence: paidRequestEvidenceFixture,
  });
  const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
  const output = await populateMasterReportDocx(template, {
    claim,
    report: {
      normalized_claim_record: stressDraft.normalizedRecord,
      assignments: stressDraft.assignments,
      version_number: 1,
    },
    issueDate: "21 August 2026",
  });
  const archive = await JSZip.loadAsync(output);
  const documentXml = await archive.file("word/document.xml").async("string");
  const renderedText = textOf(documentXml);

  assert.ok(output.length > 100_000);
  assert.match(renderedText, /ULA-AUDIT-001/);
  assert.match(renderedText, /POL-AIR-2026-8812/);
  assert.match(renderedText, /USD 39,700\.00/);
  assert.doesNotMatch(renderedText, /\{\{[^}]+\}\}/);
  assert.equal(providerCalls, 1, "Report creation and rendering must not call Anthropic again");

  await assert.rejects(
    populateMasterReportDocx(Buffer.from("not-a-docx"), {
      claim,
      report: { normalized_claim_record: stressDraft.normalizedRecord },
    }),
  );
  assert.equal(providerCalls, 1, "A report-rendering exception must not retry Anthropic");
});

test("exact paid-run nullable transport failure now completes the full production report and DOCX path", async () => {
  const transport = exactPaidFailureTransportFixture();
  const legacyFailures = legacyUnusedSlotFailures(transport);
  assert.ok(legacyFailures.includes("records.0.value"));
  assert.ok(legacyFailures.includes("records.0.normalized_value"));
  assert.ok(legacyFailures.includes("records.1.value"));
  assert.ok(legacyFailures.length > 12, "The fixture must reproduce the repeated paid-run default-slot failure");

  let providerCalls = 0;
  const provider = createAnthropicProvider({
    apiKey: "mock-audit-key",
    model: "claude-sonnet-4-6",
    maxOutputTokens: 24_000,
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: JSON.stringify(transport) }],
      })), { status: 200, headers: { "request-id": "req_exact_paid_failure_offline" } });
    },
  });
  const files = paidRequestEvidenceFixture.map((item) => ({
    mimetype: item.mime_type,
    buffer: Buffer.from(item.pages[0].text),
  }));
  const providerResult = await provider.analyze({
    claim: { id: "paid-failure-regression", claim_number: "ULA-PAID-FAILURE-001", title: "Diagnostic analyzer transit damage", claim_amount: null },
    evidence: paidRequestEvidenceFixture,
    files,
  });
  const mapped = mapAnalysis({ ...providerResult, evidence_snapshot: paidRequestEvidenceFixture });
  const claim = {
    id: "paid-failure-regression",
    claim_number: "ULA-PAID-FAILURE-001",
    title: "Diagnostic analyzer transit damage",
    business_line: "Unclassified",
    claim_amount: null,
    ai_suggested_business_line: mapped.business_line,
    ai_analysis: mapped,
  };
  const documents = paidRequestEvidenceFixture.map((item) => ({ id: item.document_id, file_name: item.document_name }));
  const draft = createUnifiedReportDraft({
    claim,
    documents,
    versions: [],
    generatedBy: "Offline Paid Failure Regression",
    analysis: mapped,
    evidence: paidRequestEvidenceFixture,
  });
  const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
  const output = await populateMasterReportDocx(template, {
    claim,
    report: { normalized_claim_record: draft.normalizedRecord, assignments: draft.assignments, version_number: 1 },
    issueDate: "21 August 2026",
  });
  const archive = await JSZip.loadAsync(output);
  const renderedText = textOf(await archive.file("word/document.xml").async("string"));

  assert.equal(providerCalls, 1);
  assert.equal(draft.normalizedRecord.financials.presented_claim, 42_200);
  assert.equal(draft.normalizedRecord.financials.concluded_indemnity, 39_700);
  assert.notEqual(draft.normalizedRecord.financials.presented_claim, 0);
  assert.equal(draft.normalizedRecord.facts.salvage_amount.value, null);
  assert.equal(draft.normalizedRecord.facts.recovery_amount.value, null);
  assert.equal(mapped.extracted_fields.find((item) => item.field === "salvage_amount").value, null);
  assert.match(renderedText, /ULA-PAID-FAILURE-001/);
  assert.match(renderedText, /USD 39,700\.00/);
  assert.doesNotMatch(renderedText, /(?:salvage|recovery)[^\n]{0,40}(?:USD )?0(?:\.00)?/i);
  assert.doesNotMatch(renderedText, /undefined|\[object Object\]/i);
  assert.ok(output.length > 100_000);
  assert.equal(providerCalls, 1, "The full post-Anthropic report path must not make a second provider request");
});

test("all paid-request failure classes stop after one mocked Anthropic transport attempt", async () => {
  const validTransport = canonicalAnalysisToAnthropicTransportFixture(currentClaimMockAnalysis());
  const responseCases = [
    ["HTTP 400", () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "invalid request" } }), { status: 400 })],
    ["HTTP 401", () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid key" } }), { status: 401 })],
    ["HTTP 429", () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limited" } }), { status: 429 })],
    ["HTTP 500", () => new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "server error" } }), { status: 500 })],
    ["malformed JSON", () => new Response(JSON.stringify(anthropicMessageFixture(undefined, { content: [{ type: "text", text: "{broken" }] })), { status: 200 })],
    ["truncated JSON", () => new Response(JSON.stringify(anthropicMessageFixture(undefined, { content: [{ type: "text", text: '{"sources":[]' }] })), { status: 200 })],
    ["max tokens", () => new Response(JSON.stringify(anthropicMessageFixture(undefined, { content: [], stop_reason: "max_tokens" })), { status: 200 })],
    ["empty response", () => new Response(JSON.stringify(anthropicMessageFixture(undefined, { content: [] })), { status: 200 })],
    ["schema validation", () => {
      const invalid = structuredClone(validTransport);
      delete invalid.records;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, { content: [{ type: "text", text: JSON.stringify(invalid) }] })), { status: 200 });
    }],
  ];

  for (const [name, responseFactory] of responseCases) {
    let calls = 0;
    const provider = createAnthropicProvider({
      apiKey: "mock-audit-key",
      fetchImpl: async () => {
        calls += 1;
        return responseFactory();
      },
    });
    await assert.rejects(
      provider.analyze({ claim: { id: `failure-${name}` }, evidence: [], files: [] }),
      undefined,
      name,
    );
    assert.equal(calls, 1, `${name} must not trigger a retry`);
  }
});

test("a structurally complete payload at Claude's output cap remains usable without a second request", async () => {
  const transport = canonicalAnalysisToAnthropicTransportFixture(currentClaimMockAnalysis());
  let calls = 0;
  const provider = createAnthropicProvider({
    apiKey: "mock-output-cap-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: JSON.stringify(transport) }],
        stop_reason: "max_tokens",
      })), { status: 200, headers: { "request-id": "req_complete_at_cap" } });
    },
  });
  const files = paidRequestEvidenceFixture.map((item) => ({
    mimetype: item.mime_type,
    buffer: Buffer.from(item.pages[0].text),
  }));

  const result = await provider.analyze({
    claim: { id: "complete-at-cap" },
    evidence: paidRequestEvidenceFixture,
    files,
  });

  assert.equal(calls, 1);
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.ok(result.analysis.warnings.some((item) => /output cap after returning a complete structured payload/i.test(item)));
  assert.ok(result.analysis.human_review_required.some((item) => /cited issue ledger is complete/i.test(item)));
});

test("grounding recovers an exact labelled policy number without replacing it with a premium-advice reference", () => {
  const evidence = [{
    document_id: "combined-docs",
    document_name: "Combined docs.pdf",
    mime_type: "application/pdf",
    kind: "pdf",
    pages: [
      { page: 1, text: "MARINE INSURANCE POLICY BY SEA\nPolicy No: ZK-MAA-0104947\nSpecial Clauses and Exclusions" },
      { page: 2, text: "PREMIUM ADVICE\nPolicy Number: ZK-MAA-1104947\nThe Sum Insured is EUR 10,000" },
    ],
  }];
  const evidenceSource = (page, supportingText) => ({
    document_id: "combined-docs",
    document_name: "Combined docs.pdf",
    page,
    supporting_text: supportingText,
    confidence: 0.95,
    evidence_mode: "extracted_text",
  });
  const grounded = anthropicProviderInternals.enforceAnthropicGrounding({
    classification: {
      business_line: "Marine Cargo (Non-Reefer)",
      confidence: 0.9,
      rationale: "The policy concerns sea cargo.",
      sources: [evidenceSource(1, "MARINE INSURANCE POLICY BY SEA")],
    },
    document_types: [],
    fields: [{
      field: "policy_number",
      value: "Sum",
      normalized_value: "Sum",
      confidence: 0.9,
      requires_confirmation: false,
      sources: [evidenceSource(2, "The Sum Insured is EUR 10,000")],
    }],
    adjustment_line_items: [],
    missing_documents: [],
    evidence_findings: [],
    summary: "Policy details require review.",
    warnings: [],
    human_review_required: [],
  }, evidence);

  const policyNumber = grounded.fields.find((item) => item.field === "policy_number");
  assert.equal(policyNumber.value, "ZK-MAA-0104947");
  assert.equal(policyNumber.sources[0].page, 1);
  assert.match(policyNumber.sources[0].supporting_text, /Policy No:\s*ZK-MAA-0104947/i);
  assert.ok(grounded.warnings.some((item) => /recovered from an expressly labelled policy reference/i.test(item)));
});

test("grounding corrects a policy number cited only from a lower-authority premium advice", () => {
  const evidence = [{
    document_id: "policy-file",
    document_name: "policy-and-advice.pdf",
    kind: "pdf",
    pages: [
      { page: 1, text: "MARINE INSURANCE POLICY\nPolicy Number: MAR-2026-0001\nSpecial Clauses" },
      { page: 2, text: "PREMIUM ADVICE\nPolicy Number: MAR-2026-9999" },
    ],
  }];
  const source = (page, supportingText) => ({
    document_id: "policy-file", document_name: "policy-and-advice.pdf", page, supporting_text: supportingText,
    confidence: 0.9, evidence_mode: "extracted_text",
  });
  const grounded = anthropicProviderInternals.enforceAnthropicGrounding({
    classification: { business_line: "Other / Requires Review", confidence: 0.8, rationale: "Policy evidence supplied.", sources: [source(1, "MARINE INSURANCE POLICY")] },
    document_types: [],
    fields: [{ field: "policy_number", value: "MAR-2026-9999", normalized_value: "MAR-2026-9999", confidence: 0.9, requires_confirmation: false, sources: [source(2, "Policy Number: MAR-2026-9999")] }],
    adjustment_line_items: [], missing_documents: [], evidence_findings: [], summary: "Policy needs review.", warnings: [], human_review_required: [],
  }, evidence);

  assert.equal(grounded.fields.find((item) => item.field === "policy_number").value, "MAR-2026-0001");
});

test("production request preparation excludes prior reports and emits duplicate image bytes once", () => {
  const context = prepareClaimContextForAnthropic({
    id: "claim-context-audit",
    title: "Current claim title",
    policy_number: "POL-CURRENT",
    ai_analysis: "PRIOR_AI_OUTPUT_SENTINEL",
    normalized_claim_record: "PRIOR_NORMALIZED_REPORT_SENTINEL",
    report_content: "PRIOR_REPORT_TEXT_SENTINEL",
  });
  assert.deepEqual(context, {
    id: "claim-context-audit",
    title: "Current claim title",
    policy_number: "POL-CURRENT",
  });

  const duplicateImage = Buffer.from("identical-image-bytes");
  const evidence = [{
    document_id: "image-a",
    document_name: "damage-a.jpg",
    mime_type: "image/jpeg",
    kind: "image",
    pages: [],
    vision_images: [{ page: 1, mime_type: "image/jpeg", buffer: duplicateImage }],
    embedded_images: [{ name: "copy.jpg", mime_type: "image/jpeg", buffer: duplicateImage }],
  }, {
    document_id: "image-b",
    document_name: "damage-copy.jpg",
    mime_type: "image/jpeg",
    kind: "image",
    pages: [],
  }];
  const files = [
    { mimetype: "image/jpeg", buffer: duplicateImage },
    { mimetype: "image/jpeg", buffer: duplicateImage },
  ];
  const body = anthropicProviderInternals.buildRequestBody({
    model: "claude-sonnet-4-6",
    maxOutputTokens: 64_000,
    claim: context,
    evidence,
    files,
  });
  const imageBlocks = body.messages[0].content.filter((block) => block.type === "image");
  const encoded = duplicateImage.toString("base64");

  assert.equal(imageBlocks.length, 1);
  assert.equal(JSON.stringify(body).split(encoded).length - 1, 1);
  assert.doesNotMatch(JSON.stringify(body), /PRIOR_(?:AI_OUTPUT|NORMALIZED_REPORT|REPORT_TEXT)_SENTINEL/);
});

test("large scanned PDF evidence is sent to Claude as one native PDF document", () => {
  const pdf = Buffer.from("%PDF-1.7 complete scanned evidence");
  const body = anthropicProviderInternals.buildRequestBody({
    model: "claude-sonnet-4-6",
    maxOutputTokens: 24_000,
    claim: { id: "native-pdf-claim" },
    evidence: [{
      document_id: "combined-docs",
      document_name: "Combined docs.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      native_pdf: true,
      pages: [{ page: 1, text: "Policy Number: POL-44" }],
    }],
    files: [{ mimetype: "application/pdf", buffer: pdf }],
  });

  const documentBlocks = body.messages[0].content.filter((block) => block.type === "document");
  assert.equal(documentBlocks.length, 1);
  assert.equal(documentBlocks[0].source.media_type, "application/pdf");
  assert.equal(documentBlocks[0].source.data, pdf.toString("base64"));
});
