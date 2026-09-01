import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createUnifiedReportDraft } from "../../src/lib/reportingEngine.js";
import {
  DIRECTOR_ASSESSOR_WORDING,
  DIRECTOR_CONCLUSION_CLOSING,
  buildMasterReportData,
  populateMasterReportDocx,
} from "../../src/lib/masterReportDocx.js";
import { MAX_REPORT_PHOTOGRAPHS, selectReportPhotographs } from "../../src/lib/reportPhotoSelection.js";
import { DIRECTOR_ANALYSIS_PROTOCOL, SYSTEM_INSTRUCTIONS, promptText } from "../ai/providers/openaiProvider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = (page, supportingText, evidenceMode = "extracted_text") => ({
  document_id: "survey-photos",
  document_name: "claim-survey-and-photographs.pdf",
  page,
  supporting_text: supportingText,
  confidence: 0.98,
  evidence_mode: evidenceMode,
});

const field = (name, value, page = 1) => ({
  field: name,
  value,
  normalized_value: value,
  confidence: 0.98,
  requires_confirmation: false,
  sources: [source(page, String(value))],
});

function fixture() {
  const evidence = [{
    document_id: "survey-photos",
    document_name: "claim-survey-and-photographs.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    searchable_page_count: 3,
    image_only_page_count: 6,
    pages: [
      { page: 1, text: "Ceramic washbasins shipped in standard export cartons. Consignee: Levant Ceramics Invoice No.:20260306" },
      { page: 2, text: "Survey found broken ceramic units and cartons. Container seals intact with no forced entry." },
      { page: 3, text: "Claimed quantity 12 units; surveyed quantity 10 units." },
      ...Array.from({ length: 6 }, (_, index) => ({ page: index + 4, text: "", extraction_status: "image-only" })),
    ],
  }];
  const documents = [{ id: "survey-photos", file_name: "claim-survey-and-photographs.pdf", detected_categories: ["Survey Report", "Photographs"] }];
  const analysis = {
    summary: "Fragile ceramic washbasins sustained breakage identified during unloading, with intact seals and limited internal cushioning materially informing the causal assessment. The claimed and surveyed quantities require reconciliation before final adjustment.",
    warnings: ["Conflicting evidence values were found for affected quantity."],
    human_review_required: ["Human review required: reconcile surveyed quantity."],
    extracted_fields: [
      field("report_introduction", "At the request of Example Insurer, we attended to investigate the reported transit damage to the Assured's ceramic washbasins."),
      field("insured", "Levant Ceramics SAL"),
      field("consignee", "Levant Ceramics Invoice No.:20260306"),
      field("commodity", "Fragile ceramic washbasins"),
      field("policy_number", "MC-2026-001"),
      field("voyage_to", "Place of Del iv ery . Appl icable only when document used as Mul timodal T r ansport B/L"),
      field("seal_condition", "Container seals intact; no signs of forced entry", 2),
      field("damage_findings", "Broken cartons and fractured ceramic washbasins observed during unloading", 2),
      field("affected_quantity", "10", 3),
      field("affected_quantity", "12", 3),
      field("currency", "USD"),
      field("invoice_total", "10,000.00"),
      field("insured_value", "11,000.00"),
      field("valuation_basis", "Invoice value"),
      field("gross_claim_amount", "10,000.00"),
      field("adjusted_amount", "9,500.00"),
      field("deductible", "500.00"),
      field("salvage_amount", "0.00"),
      field("recovery_amount", "0.00"),
      field("depreciation_amount", "0.00"),
    ],
    document_types: [],
    adjustment_line_items: [],
    evidence_findings: [
      { finding: "Fragile ceramic washbasins were packed in standard export cartons without foam cushioning.", confidence: 0.98, sources: [source(1, "standard export cartons without foam cushioning")] },
      { finding: "Broken cartons and fractured ceramic units were observed when the cargo was unloaded at the consignee's warehouse.", confidence: 0.99, sources: [source(4, "broken cartons and fractured ceramic units", "document_vision")] },
      { finding: "The container seals were intact and there was no sign of forced entry.", confidence: 0.98, sources: [source(5, "container seals intact; no forced entry", "document_vision")] },
      { finding: "Discovery during unloading establishes when the damage became visible but does not establish when the damaging event occurred.", confidence: 0.96, sources: [source(2, "damage discovered during unloading")] },
      { finding: "In our opinion, on balance, the breakage appears consistent with impact, compression or cargo movement during handling or transit, with the absence of foam cushioning increasing the washbasins' susceptibility; inadequate protection is likely contributory, while a single severe impact cannot be excluded.", confidence: 0.92, sources: [source(4, "representative fractured washbasins", "document_vision"), source(6, "standard cartons with no foam", "document_vision")] },
      { finding: "The carrier did not attend the joint survey, limiting independent agreement on the condition and quantities.", confidence: 0.97, sources: [source(3, "carrier did not attend")] },
    ],
  };
  const claim = { claim_number: "ULA-NARRATIVE-001", title: "Ceramic washbasin transit damage", business_line: "Marine Cargo (Non-Reefer)" };
  return { evidence, documents, analysis, claim };
}

test("production prompt requires concise fact-to-interpretation-to-conclusion reasoning", () => {
  assert.match(SYSTEM_INSTRUCTIONS, /every analytical section, move from supported facts to professional interpretation\/significance and then a reasoned adjuster\/surveyor conclusion/i);
  assert.match(SYSTEM_INSTRUCTIONS, /never merely restate facts/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Keep conclusions proportionate.*qualify uncertainty and alternatives.*never invent or pad/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Do not use "not established".*as a substitute for analysis/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Do not suppress a defensible analysis merely because the conclusion is provisional/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Use "not established" only after testing the material hypotheses/i);
  assert.match(SYSTEM_INSTRUCTIONS, /preserve its substantive wording verbatim in report_introduction/i);
  assert.match(SYSTEM_INSTRUCTIONS, /party fields as named entities, not text buckets/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Separately extract the exact policy or cover-note number/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Never add the full shipment value to the value of damaged items/i);
  assert.match(SYSTEM_INSTRUCTIONS, /smaller affected quantity.*maximum supported loss scope/i);
  assert.match(SYSTEM_INSTRUCTIONS, /scanner watermark or a few OCR characters/i);
  assert.match(SYSTEM_INSTRUCTIONS, /charge is not automatically a claim item merely because an invoice exists/i);
  assert.match(SYSTEM_INSTRUCTIONS, /complete quantity expression and rate with an empty adjusted value/i);
  assert.match(SYSTEM_INSTRUCTIONS, /interest and policy schedule; shipment routing; chronological surveyor notes/i);
  assert.match(SYSTEM_INSTRUCTIONS, /deductible percentage\/minimum\/maximum\/fixed\/franchise\/aggregate/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Quotations, estimates, and pro-formas/i);
  assert.match(SYSTEM_INSTRUCTIONS, /master\/house B\/L/i);
  assert.match(SYSTEM_INSTRUCTIONS, /amount-in-words/i);
  assert.match(SYSTEM_INSTRUCTIONS, /dangling connector.*p\..*pp\./i);
});

test("percentage deductible with a monetary minimum is calculated as a formula and never concatenated", () => {
  const policySource = { ...source(1, "Deductible: 10% of the adjusted loss, subject to a minimum EUR 750 each and every loss"), document_name: "policy.pdf" };
  const claimSource = { ...source(2, "Claim form amount EUR 5,865.44"), document_name: "claim-form.pdf" };
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    extracted_fields: [
      { ...field("currency", "EUR"), sources: [claimSource] },
      { ...field("gross_claim_amount", "5865.44"), sources: [claimSource] },
      { ...field("adjusted_amount", "5115.44"), sources: [{ ...claimSource, supporting_text: "Net adjusted amount EUR 5,115.44" }] },
      { ...field("deductible", "10750"), sources: [policySource] },
      field("salvage_amount", "0"), field("recovery_amount", "0"), field("depreciation_amount", "0"),
    ],
    adjustment_line_items: [{
      description: "Supported replacement of damaged cargo", quantity: "1 unit", unit_price: "5865.44", adjusted_value: "5865.44", currency: "EUR",
      basis: "Claim form and damaged-item valuation", confidence: 0.98, sources: [claimSource],
    }],
    document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Non-Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const record = draft.normalizedRecord;
  const data = buildMasterReportData({ report: { normalized_claim_record: record }, claim: {} });

  assert.equal(record.financials.deductible_terms.percentage, 10);
  assert.equal(record.financials.deductible_terms.minimum, 750);
  assert.equal(record.financials.deductible, 750);
  assert.equal(record.financials.provisional_indemnity, 5115.44);
  assert.equal(record.financials.concluded_indemnity, 5115.44);
  assert.ok(record.financials.provisional_indemnity >= 0);
  assert.match(data.scalars.policy_details, /10%.*minimum EUR 750/i);
  assert.match(data.paragraphs.conclusion_items[0], /EUR 5,865\.44 is considered fair & reasonable/i);
  assert.doesNotMatch(JSON.stringify(data), /EUR 10,750\.00/);
});

test("quotation evidence remains provisional and cannot become a presented or fair-and-reasonable claim", () => {
  const quoteSource = { ...source(1, "Replacement quotation Q-901 total EUR 5,865.44 including VAT"), document_name: "replacement-quotation.pdf" };
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    extracted_fields: [field("currency", "EUR"), field("salvage_amount", "0"), field("recovery_amount", "0"), field("depreciation_amount", "0")],
    adjustment_line_items: [{
      description: "Replacement quotation", quantity: "1 unit", unit_price: "5865.44", adjusted_value: "5865.44", currency: "EUR",
      basis: "Supplier quotation only", confidence: 0.99, sources: [quoteSource],
    }],
    document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Non-Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.financials.presented_claim, null);
  assert.equal(draft.normalizedRecord.financials.itemized_evidence_basis, "quotation");
  assert.match(data.paragraphs.adjustment_intro.join(" "), /quotation or estimate evidence only/i);
  assert.match(data.paragraphs.conclusion_items[0], /cannot be stated as fair & reasonable.*quotation or estimate evidence/i);
});

test("surveyor estimates, extrapolations, and miscellaneous schedules remain provisional", () => {
  const surveySource = { ...source(8, "Surveyor's estimated amount of loss EUR 39,222 by extrapolation from a 10% sample; miscellaneous expenses subject to verification"), document_name: "survey-report.pdf" };
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [field("currency", "EUR")],
    adjustment_line_items: [{
      description: "Estimated cargo loss and miscellaneous expenses",
      quantity: "1 schedule",
      unit_price: "39222",
      adjusted_value: "39222",
      currency: "EUR",
      basis: "Surveyor's estimate by extrapolation; subject to verification",
      confidence: 0.98,
      sources: [surveySource],
    }],
    document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.financials.itemized_evidence_basis, "provisional");
  assert.equal(draft.normalizedRecord.financials.presented_claim, null);
  assert.equal(draft.normalizedRecord.financials.concluded_indemnity, null);
  assert.match(data.paragraphs.adjustment_intro.join(" "), /extrapolated.*provisional evidence/i);
  assert.match(data.paragraphs.conclusion_items[0], /cannot be stated as fair & reasonable.*provisional evidence/i);
});

test("a surveyor's qualified cause opinion is not promoted to an express source fact", () => {
  const opinion = "We are led to believe that frost-related airflow restriction likely contributed to deterioration";
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [field("cause_of_loss", opinion)],
    adjustment_line_items: [], document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.cause_assessment.explicit_cause, null);
  assert.ok(draft.normalizedRecord.cause_assessment.hypotheses.some((item) => item.status === "reasoned_professional_opinion"));
  assert.match(data.paragraphs.cause_of_loss_section[0], /not expressly established as a source fact/i);
  assert.doesNotMatch(data.paragraphs.cause_of_loss_section[0], /^The proximate cause of loss is frost/i);
});

test("plain CIF is not treated as an insurance valuation basis", () => {
  const cifSource = { ...source(2, "Incoterm: CIF"), document_name: "commercial-invoice.pdf" };
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [
      field("currency", "EUR"),
      field("invoice_total", "64800"),
      field("insured_value", "99195"),
      { ...field("valuation_basis", "CIF"), sources: [cifSource] },
    ],
    adjustment_line_items: [], document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.facts.valuation_basis.value, null);
  assert.match(data.paragraphs.adequacy_section[0], /cannot be established from the available evidence/i);
  assert.doesNotMatch(data.paragraphs.adequacy_section[0], /no underinsurance/i);
});

test("report parties require evidence and reject bill-of-lading OCR labels", () => {
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [field("consignee", "WOODEN PACKAGE: NOT APPLICABLE (NOT USED)")],
    adjustment_line_items: [], document_types: [], evidence_findings: [],
  };
  const claim = { business_line: "Marine Cargo (Reefer)", applicant: "ULA" };
  const draft = createUnifiedReportDraft({ claim, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim });

  assert.equal(draft.normalizedRecord.facts.applicant.value, null);
  assert.equal(draft.normalizedRecord.facts.consignee.value, null);
  assert.doesNotMatch(JSON.stringify(data), /WOODEN PACKAGE|At the request of ULA/i);
});

test("conflicting salient dates are withheld from chronology and client arrival wording", () => {
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [field("arrival_date", "25 March 2026", 2), field("arrival_date", "19 April 2026", 3)],
    adjustment_line_items: [], document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.facts.arrival_date.status, "conflict");
  assert.ok(!draft.normalizedRecord.chronology.some((event) => event.field === "arrival_date"));
  assert.doesNotMatch(String(data.scalars.arrival_delivery_details), /25 March 2026|19 April 2026/i);
});

test("container merging removes duplicates and invalid OCR check-digit variants", () => {
  const analysis = {
    business_line: "Marine Cargo (Reefer)",
    extracted_fields: [
      field("container_numbers", "MNBU3108501, MNBU4309901"),
      field("container_numbers", "MNBU3108501, MNBU3100850"),
    ],
    adjustment_line_items: [], document_types: [], evidence_findings: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });

  assert.equal(draft.normalizedRecord.facts.container_numbers.value, "MNBU3108501, MNBU4309901");
});

test("transport conflicts, invoice words conflicts, and policy categories remain visible", () => {
  const evidence = [{
    document_id: "combined", document_name: "combined.pdf", mime_type: "application/pdf", extraction_status: "extracted",
    pages: [{ page: 1, text: "COMMERCIAL INVOICE\nAmount due EUR 87,982.51\nSEVENTY-FIVE THOUSAND EIGHT HUNDRED THIRTY-FIVE AND 11/100 EUROS" }],
  }];
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    extracted_fields: [
      field("currency", "EUR"),
      field("master_bill_of_lading", "BRT0311410"),
      field("house_bill_of_lading", "CTL/BEY/2026-14"),
      field("vessel_name", "VESSEL ALPHA"),
      field("vessel_name", "VESSEL BETA"),
      field("policy_exclusions", "Warranted preliminary survey before loading"),
    ],
    document_types: [], evidence_findings: [], adjustment_line_items: [],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Non-Reefer)" }, documents: [{ id: "combined", file_name: "combined.pdf" }], versions: [], generatedBy: "Test", analysis, evidence });
  const record = draft.normalizedRecord;
  const data = buildMasterReportData({ report: { normalized_claim_record: record }, claim: {} });

  assert.equal(record.facts.invoice_total.status, "conflict");
  assert.ok(record.conflicts.some((item) => item.field === "invoice_total"));
  assert.equal(record.facts.policy_exclusions.value, null);
  assert.match(record.facts.policy_warranties.value, /Warranted preliminary survey/i);
  assert.match(data.scalars.transport_document, /Master B\/L BRT0311410.*House B\/L CTL\/BEY\/2026-14/i);
  assert.match(data.paragraphs.shipment_routing.join(" "), /Conflicting evidence values were found for vessel name/i);
  assert.match(data.paragraphs.adequacy_section[0], /cannot be established/i);
});

test("dangling findings are identified before final issue and are not cut into the client narrative", () => {
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)", extracted_fields: [], document_types: [], adjustment_line_items: [],
    evidence_findings: [{ finding: "The crate frame collapsed during handling. Damage is shown in photos pp.", confidence: 0.98, sources: [source(2, "The crate frame collapsed during handling. Damage is shown in photos pp.")] }],
  };
  const draft = createUnifiedReportDraft({ claim: { business_line: "Marine Cargo (Non-Reefer)" }, documents: [], versions: [], generatedBy: "Test", analysis, evidence: [] });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.ok(draft.normalizedRecord.report_quality.issue_blockers.some((item) => /dangling narrative/i.test(item)));
  assert.doesNotMatch(data.paragraphs.cause_of_loss_section.join(" "), /photos pp\./i);
  assert.match(data.paragraphs.cause_of_loss_section.join(" "), /crate frame collapsed during handling/i);
});

test("production analysis performs a Director-grade evidence challenge before structured output", () => {
  assert.match(SYSTEM_INSTRUCTIONS, /senior insurance loss adjuster and surveyor/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /two internal passes before encoding the response/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /owner-approved methodology note as an analysis checklist/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /factual chronology and custody; physical condition and extent; proximate cause; policy application; quantum and mitigation; liability and recovery/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /domain-labelled evidence_finding/i);
  assert.match(SYSTEM_INSTRUCTIONS, /chronology_custody.*condition_extent.*proximate_cause.*policy_application.*quantum_mitigation.*liability_recovery/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /evidence that strengthens and weakens the proposition; viable competing explanations/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /Cause analysis must test mechanisms, timing, custody, physical consistency, counterevidence, and alternatives/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /compare pre-loading with delivery condition, affected with sound packages or components/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /prior similar shipments.*never as standalone proof of cause or packing compliance/is);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /Separate observed physical damage from inferred internal failure, contamination, hygiene, safety, fitness for purpose, repairability, and total loss/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /screening test identifies only what its evidenced method supports/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /Policy analysis must pair each material clause.*with the established current-claim facts/is);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /policy-issue hierarchy.*independently established scope, territorial, duration, limit, or exclusion issue/is);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /which verified issue could control the provisional outcome.*leaving final legal effect and coverage approval/is);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /Quantum analysis must reconcile the scope of loss at the smallest evidenced unit/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /Liability and recovery analysis must identify each plausible party separately/i);
  assert.match(DIRECTOR_ANALYSIS_PROTOCOL, /audit it for unsupported assertions, missed pages or parties, generic filler/i);

  const prompt = promptText(
    { id: "director-review", business_line: "Marine Cargo (Non-Reefer)" },
    [{
      document_id: "doc-1",
      document_name: "claim.pdf",
      mime_type: "application/pdf",
      extraction_status: "complete",
      pages: [{ page: 1, text: "Bill of Lading and dry container evidence." }],
    }],
    [{
      profile_id: "non-reefer-cargo",
      title: "Approved methodology",
      section_order: [],
      style_notes: ["Test packing, custody, causation and recovery."],
      applies_to: { evidence_terms_any: ["dry container"], business_lines: ["Marine Cargo (Non-Reefer)"] },
      source_role: "style_reference_only",
    }],
  );
  assert.match(prompt, /owner-approved analysis methodology/i);
  assert.match(prompt, /Execute every material test in the applicable owner-approved methodology profile/i);
  assert.match(prompt, /Do not merely restate the profile or the evidence/i);
  assert.match(prompt, /completing the final quality audit/i);
  assert.match(prompt, /alternative quantities and units in separate sourced records.*never concatenate/is);
  assert.match(prompt, /loss rows separate from deductible, salvage, recovery, and depreciation/is);
  assert.match(prompt, /cause_of_loss is only one concise express source-stated mechanism/is);
  assert.match(prompt, /Follow clauses across line or page breaks.*return null/is);
  assert.match(prompt, /Produce client-ready synthesis, not an extraction dump/i);
  assert.match(prompt, /preserve draft\/original transport status/i);
  assert.match(prompt, /reconcile quotation lines, ancillary charges, VAT\/tax and deductible separately/i);
  assert.match(prompt, /enforce the same parties, chronology, currency, claim status, cause qualification, cover and liability position across summary, analysis, adjustment and conclusion/i);
  assert.match(prompt, /make each evidence gap specific to the decision it would resolve/i);
});

test("professional report narrative remains grounded, analytical, concise, and deterministic", async () => {
  const { evidence, documents, analysis, claim } = fixture();
  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test Adjuster", analysis, evidence });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord, assignments: draft.assignments }, claim, issueDate: "21 August 2026" });
  const cause = data.paragraphs.cause_of_loss_section;
  const narrative = [
    ...data.paragraphs.report_summary_findings,
    ...data.paragraphs.surveyor_notes,
    ...cause,
    ...data.paragraphs.conclusion_items,
  ].join("\n");

  assert.ok(cause.length >= 2 && cause.length <= 5);
  assert.match(cause[0], /^The proximate cause of loss is /);
  assert.match(cause.join(" "), /In our opinion, on balance/i);
  assert.match(cause.join(" "), /intact|forced entry/i);
  assert.match(cause.join(" "), /foam cushioning|inadequate protection/i);
  assert.doesNotMatch(narrative, /Human review required|conflicting evidence values were found/i);
  assert.equal(data.paragraphs.report_summary_intro[0], "At the request of Example Insurer, we attended to investigate the reported transit damage to the Assured's ceramic washbasins.");
  assert.match(data.paragraphs.report_summary_intro[1], /^In brief, Table 1 records /);
  assert.deepEqual(data.paragraphs.report_summary_findings, []);
  assert.deepEqual(data.paragraphs.document_sighting, []);
  assert.match(data.paragraphs.adequacy_section[0], /invoice values are adequately insured and there is no underinsurance/i);
  assert.deepEqual(data.paragraphs.assessors_section, [DIRECTOR_ASSESSOR_WORDING]);
  assert.equal(data.paragraphs.conclusion_items.length, 5);
  assert.equal(data.paragraphs.conclusion_items[0], "The above adjusted claim amount USD 9,500.00 is considered fair & reasonable.");
  assert.match(data.paragraphs.conclusion_items[1], /^The proximate cause of loss is /);
  assert.match(data.paragraphs.conclusion_items[2], /^Cover advice:/);
  assert.match(data.paragraphs.conclusion_items[3], /^Liable-party position:/);
  assert.equal(data.paragraphs.conclusion_items[4], DIRECTOR_CONCLUSION_CLOSING);
  assert.doesNotMatch(JSON.stringify(data.scalars), /Place of Del iv ery|Mul timodal T r ansport|Invoice No\.:20260306/i);
  assert.equal(data.scalars.summary_consignee, "Levant Ceramics");
  assert.equal(draft.normalizedRecord.financials.presented_claim, 10_000);
  assert.equal(draft.normalizedRecord.financials.concluded_indemnity, 9_500);
  assert.equal(draft.normalizedRecord.financials.arithmetic_valid, true);
  assert.equal(draft.normalizedRecord.cause_assessment.assessment_level, "provisional_evidence_based_opinion");
  assert.ok(draft.normalizedRecord.cause_assessment.hypotheses.some((hypothesis) => hypothesis.status === "reasoned_professional_opinion"));
  assert.ok(draft.normalizedRecord.report_quality.checks.some((check) => check.id === "causation" && check.status === "passed_with_professional_review"));
  assert.equal((narrative.match(/Source:/g) || []).length, 0);
  assert.ok(draft.normalizedRecord.evidence_findings.every((item) => item.sources.length > 0));
  assert.ok(draft.normalizedRecord.selected_photographs.length >= 3);
  assert.ok(draft.normalizedRecord.selected_photographs.length <= 6);
  const summaryStart = draft.content.indexOf("## Report Summary");
  const reportNoteStart = draft.content.indexOf("## Report and adjustment note");
  const summaryContent = draft.content.slice(summaryStart, reportNoteStart);
  assert.ok(summaryContent.indexOf(data.paragraphs.report_summary_intro[0]) < summaryContent.indexOf("| Assured's / Shipper's Name |"));
  assert.ok(summaryContent.indexOf("In brief, Table 1 records") < summaryContent.indexOf("| Assured's / Shipper's Name |"));
  assert.ok(summaryContent.indexOf("| Assured's / Shipper's Name |") < summaryContent.indexOf("### In our opinion"));
  assert.doesNotMatch(summaryContent, /The following was concluded|Human review required/i);
  assert.doesNotMatch(draft.content, /End of adjustment note\./i);

  const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
  const output = await populateMasterReportDocx(template, {
    report: { normalized_claim_record: draft.normalizedRecord, assignments: draft.assignments },
    claim,
    issueDate: "21 August 2026",
  });
  const archive = await JSZip.loadAsync(output);
  const xml = await archive.file("word/document.xml").async("string");
  assert.match(xml, /In our opinion, on balance/i);
  assert.match(xml, /The proximate cause of loss is /i);
  assert.match(xml, /invoice values are adequately insured and there is no underinsurance/i);
  assert.match(xml, /To date, it is understood that the Assured had not appointed a loss assessor to act on their behalf\./i);
  assert.match(xml, /The above adjusted claim amount USD 9,500\.00 is considered fair &amp; reasonable\./i);
  assert.match(xml, /SHIPMENT ROUTING/i);
  assert.match(xml, /Pending professional approval/i);
  assert.match(xml, /We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions\./i);
  assert.doesNotMatch(xml, /The following was concluded:|End of adjustment note\./i);
  assert.doesNotMatch(xml, /Human review required/i);
});

test("global report analysis separates policy schedule, party roles, routing, and actual loss quantum", () => {
  const { evidence, documents } = fixture();
  const claim = {
    claim_number: "ULA-GLOBAL-QUALITY-001",
    title: "Machinery transit damage",
    business_line: "Marine Cargo (Non-Reefer)",
    applicant: "a) the Reinsurer shall be liable to pay even though another party is unable",
  };
  const analysis = {
    business_line: claim.business_line,
    document_types: [],
    evidence_findings: [],
    extracted_fields: [
      field("policy_number", "MC/2026/4455"),
      field("policy_period", "01 January 2026 to 31 December 2026"),
      field("insured_value", "748,000.00"),
      field("currency", "USD"),
      field("valuation_basis", "Invoice Value + 10%"),
      field("policy_transit_scope", "Warehouse to warehouse"),
      field("policy_conveyance_limits", "USD 350,000 per land conveyance"),
      field("policy_extensions", "Including loading and unloading operations"),
      field("policy_warranties", "Warranted cargo properly lashed and secured"),
      field("policy_conditions", "Institute Cargo Clauses (A) CL.382 dated 01.01.2009"),
      field("policy_exclusions", "Excluding theft from open or unattended trucks"),
      field("gross_claim_amount", "1,088,250.00"),
      field("applicant", "a) the Reinsurer shall be liable to pay even though another party is unable"),
      field("shipper", "CARRIER'S AGENTS ENDORSEMENTS"),
      field("consignee", "EXPORTED BY:"),
      field("carrier", "Place of Del iv ery. Applicable only when document used as Multimodal Transport B/L"),
      field("port_of_loading", "Shanghai, China"),
      field("transshipment_port", "Singapore"),
      field("port_of_discharge", "Dar Es Salaam, Tanzania"),
      field("vessel_name", "MV PROFESSIONAL"),
      field("voyage_number", "026E"),
      field("bill_of_lading", "BL-2026-4455"),
      field("delivery_date", "14 May 2026"),
      field("empty_return_date", "16 May 2026"),
    ],
    adjustment_line_items: [
      { description: "Damaged generator set", quantity: "1 unit", unit_price: "340250", adjusted_value: "340250", currency: "USD", basis: "Surveyed damage item", confidence: 0.98, sources: [source(2, "Damaged generator set USD 340,250.00")] },
      { description: "Total insured shipment value", quantity: null, unit_price: null, adjusted_value: "748000", currency: "USD", basis: "Policy / shipment value", confidence: 0.98, sources: [source(1, "Total insured shipment value USD 748,000.00")] },
      { description: "Claimed insured value based on commercial invoice total for all 5 containers", quantity: "135000 kg", unit_price: "1.35", adjusted_value: "182250", currency: "USD", basis: "Provisional; affected quantity to be determined after survey", confidence: 0.98, sources: [source(2, "Commercial invoice total for all containers USD 182,250.00")] },
    ],
  };
  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test Adjuster", analysis, evidence });
  const record = draft.normalizedRecord;
  const data = buildMasterReportData({ report: { normalized_claim_record: record }, claim });

  assert.equal(record.facts.applicant.value, null);
  assert.equal(record.facts.shipper.value, null);
  assert.equal(record.facts.consignee.value, null);
  assert.equal(record.facts.carrier.value, null);
  assert.equal(record.adjustment.line_items.length, 1);
  assert.equal(record.financials.presented_claim, 340_250);
  assert.ok(record.conflicts.some((item) => item.field === "adjustment_line_items"));
  assert.match(data.scalars.policy_details, /MC\/2026\/4455/);
  assert.match(data.scalars.policy_details, /Insured Period: 01 January 2026 to 31 December 2026/);
  assert.match(data.scalars.policy_details, /Warehouse to warehouse/);
  assert.match(data.scalars.policy_details, /Warranted cargo properly lashed and secured/);
  assert.match(data.scalars.policy_details, /Excluding theft from open or unattended trucks/);
  assert.match(data.paragraphs.policy_conditions_section.join(" "), /evidenced wording: Including loading and unloading operations/i);
  assert.match(data.paragraphs.shipment_routing.join(" "), /Shanghai.*Singapore.*Dar Es Salaam|Shanghai.*Dar Es Salaam/i);
  assert.match(data.paragraphs.shipment_routing.join(" "), /empty container returned 16 May 2026/i);
  assert.doesNotMatch(data.scalars.policy_details, /Carrier's Agents Endorsements/i);
});

test("Director wording remains explicit without inventing conclusions when evidence is insufficient", () => {
  const draft = createUnifiedReportDraft({
    claim: { claim_number: "ULA-DIRECTOR-GAPS-001", title: "Evidence-limited claim" },
    documents: [],
    versions: [],
    generatedBy: "Test Adjuster",
    analysis: { business_line: "Other / Requires Review", extracted_fields: [], document_types: [], evidence_findings: [] },
    evidence: [],
  });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(data.paragraphs.cause_of_loss_section[0], "The proximate cause of loss is not established from the available evidence.");
  assert.match(data.paragraphs.adequacy_section[0], /invoice values are adequately insured.*underinsurance cannot be established from the available evidence/i);
  assert.match(data.paragraphs.conclusion_items[0], /cannot be stated as fair & reasonable.*not established/i);
  assert.doesNotMatch(data.paragraphs.conclusion_items[0], /USD\s+[0-9,.]+/);
  assert.match(data.paragraphs.conclusion_items[2], /^Cover advice:.*cannot be advised/i);
  assert.match(data.paragraphs.conclusion_items[3], /^Liable-party position: No liable party is established/i);
  assert.equal(data.paragraphs.conclusion_items.at(-1), DIRECTOR_CONCLUSION_CLOSING);
  assert.equal(data.paragraphs.assessors_section[0], DIRECTOR_ASSESSOR_WORDING);
  assert.equal(draft.normalizedRecord.report_quality.approval_required_before_issue, true);
});

test("production report extraction preserves an existing Introduction without relying on provider output", () => {
  const introduction = "At the request of the Applicant, ULA attended the Assured's premises to investigate the reported cargo loss and report to Insurers.";
  const evidence = [{
    document_id: "current-report",
    document_name: "Current claim report.docx",
    pages: [{
      page: 3,
      text: `REPORT SUMMARY\nINTRODUCTION\n${introduction}\nSURVEYOR NOTES\nThe cargo condition was inspected.\nCAUSE OF LOSS\nCause remains under review.\nCONCLUSION\nIn our opinion, further evidence is required.`,
    }],
  }];
  const draft = createUnifiedReportDraft({
    claim: { claim_number: "ULA-INTRO-001" },
    documents: [{ id: "current-report", file_name: "Current claim report.docx" }],
    versions: [],
    generatedBy: "Test Adjuster",
    analysis: { business_line: "Other / Requires Review", extracted_fields: [], document_types: [], evidence_findings: [] },
    evidence,
  });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim: {} });

  assert.equal(draft.normalizedRecord.facts.report_introduction.status, "supported");
  assert.equal(data.paragraphs.report_summary_intro[0], introduction);
});

test("adequacy wording states underinsurance only from comparable evidenced values", () => {
  const { evidence, documents, analysis, claim } = fixture();
  analysis.extracted_fields = analysis.extracted_fields.map((item) => item.field === "insured_value" ? field("insured_value", "8,000.00") : item);
  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test Adjuster", analysis, evidence });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim });

  assert.match(data.paragraphs.adequacy_section[0], /invoice values are not adequately insured and there is underinsurance of USD 2,000\.00/i);
});

test("conflicting values cannot become Director cause or underinsurance assertions", () => {
  const { evidence, documents, analysis, claim } = fixture();
  analysis.extracted_fields.push(
    field("cause_of_loss", "Heavy impact during transit", 2),
    field("cause_of_loss", "Pre-shipment breakage", 2),
    field("insured_value", "8,000.00"),
  );
  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test Adjuster", analysis, evidence });
  const data = buildMasterReportData({ report: { normalized_claim_record: draft.normalizedRecord }, claim });

  assert.equal(draft.normalizedRecord.facts.cause_of_loss.status, "conflict");
  assert.equal(draft.normalizedRecord.facts.insured_value.status, "conflict");
  assert.doesNotMatch(data.paragraphs.cause_of_loss_section[0], /^The proximate cause of loss is (?:Heavy impact during transit|Pre-shipment breakage)\./);
  assert.match(data.paragraphs.adequacy_section[0], /cannot be established from the available evidence/i);
  assert.doesNotMatch(data.paragraphs.adequacy_section[0], /there is (?:no )?underinsurance on|there is underinsurance of/i);
});

test("photograph selection caps material views and removes exact duplicates", () => {
  const preferred = Array.from({ length: 14 }, (_, index) => ({
    document_id: "survey-photos",
    document_name: "claim-survey-and-photographs.pdf",
    page: index + 1,
    caption: `Material view ${index + 1}`,
  }));
  const images = preferred.map((item, index) => ({ ...item, data: new Uint8Array([index + 1, 2, 3, 4]) }));
  images.splice(2, 0, { ...preferred[0], page: 99, data: images[0].data, caption: "Duplicate bytes" });
  const selected = selectReportPhotographs(images, preferred);
  assert.equal(selected.length, MAX_REPORT_PHOTOGRAPHS);
  assert.equal(MAX_REPORT_PHOTOGRAPHS, 12);
  assert.equal(selected.filter((item) => item.data === images[0].data).length, 1);
  assert.ok(selected.every((item) => /Material view/.test(item.caption)));
});

test("non-reefer regression keeps composite evidence, deductions, cause, policy, and issue controls separate", () => {
  const claimSource = (page, supportingText) => ({
    document_id: "non-reefer-bundle",
    document_name: "Non-reefer claim bundle.pdf",
    page,
    supporting_text: supportingText,
    confidence: 0.99,
    evidence_mode: "extracted_text",
  });
  const extractedField = (name, value, page = 1) => ({
    field: name,
    value,
    normalized_value: value,
    confidence: 0.99,
    requires_confirmation: false,
    sources: [claimSource(page, String(value))],
  });
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    document_types: [],
    extracted_fields: [
      extractedField("currency", "USD"),
      extractedField("insured", "Example Imports Ltd"),
      extractedField("shipper", "Example Export Cooperative"),
      extractedField("consignee", "Example Destination SARL"),
      extractedField("quantity", "1,045 cartons / 915 pcs", 18),
      extractedField("affected_quantity", "30 surveyed; 26 damaged + 1 missing in claim schedule", 31),
      extractedField("gross_claim_amount", "471.40", 31),
      extractedField("adjusted_amount", "221.40", 31),
      extractedField("deductible", "250.00", 2),
      extractedField("salvage_amount", "0.00", 31),
      extractedField("recovery_amount", "0.00", 31),
      extractedField("depreciation_amount", "0.00", 31),
      extractedField("valuation_uplift_percent", "10", 2),
      extractedField("policy_inception_date", "2025-11-03", 2),
      extractedField("invoice_date", "2026-03-06", 12),
      extractedField("packing_list_date", "2026-03-06", 18),
      extractedField("departure_date", "2026-05-20", 20),
      extractedField("shipment_date", "2026-05-20", 20),
      extractedField("policy_warranties", "Warranted Independent Satisfactory Pre-Shipment Loading, Stowage,", 2),
      extractedField("policy_exclusions", "Excluded Countries Clause: This Policy does not Cover Shipments To and/or", 3),
      extractedField("cause_of_loss", "Physical breakage was observed; packing was described without foam; no impact damage was recorded; damage was discovered after delivery.", 30),
    ],
    adjustment_line_items: [
      { description: "Model 7002 broken items", quantity: "19", unit_price: "18.20", adjusted_value: "345.80", currency: "USD", basis: "Claim schedule", confidence: 0.99, sources: [claimSource(31, "19 x 18.20 = 345.80")] },
      { description: "Model 7003 broken items", quantity: "6", unit_price: "17.10", adjusted_value: "102.60", currency: "USD", basis: "Claim schedule", confidence: 0.99, sources: [claimSource(31, "6 x 17.10 = 102.60")] },
      { description: "Model H-477 missing item", quantity: "1", unit_price: "23.00", adjusted_value: "23.00", currency: "USD", basis: "Claim schedule", confidence: 0.99, sources: [claimSource(31, "1 x 23.00 = 23.00")] },
      { description: "Policy deductible", quantity: "", unit_price: "", adjusted_value: "-250.00", currency: "USD", basis: "Less deductible", confidence: 0.99, sources: [claimSource(2, "Deductible USD 250")] },
    ],
    evidence_findings: [
      { analysis_domain: "condition_extent", finding: "Physical breakage affected ceramic items, while one separately claimed H-477 item was reported missing.", confidence: 0.99, sources: [claimSource(30, "broken items and one missing H-477")] },
      { analysis_domain: "proximate_cause", finding: "The observed breakage is consistent with handling impact or cargo movement, but the available evidence does not isolate the event or custody stage.", confidence: 0.92, sources: [claimSource(30, "physical breakage observed")] },
      { analysis_domain: "quantum_mitigation", finding: "The claimed quantity is covered by two inconsistent source positions and requires reconciliation.", confidence: 0.99, sources: [claimSource(31, "survey 30; claim schedule 27")] },
      { analysis_domain: "policy_application", finding: "The deductible and valuation provision may apply to the reconciled loss schedule; the incomplete warranty and exclusion fragments cannot determine cover.", confidence: 0.94, sources: [claimSource(2, "Deductible USD 250; invoice value plus 10%")] },
    ],
  };
  const evidence = [{
    document_id: "non-reefer-bundle",
    document_name: "Non-reefer claim bundle.pdf",
    mime_type: "application/pdf",
    extraction_status: "extracted",
    pages: [{ page: 1, text: "Marine cargo policy and non-reefer sea shipment." }],
  }];
  const draft = createUnifiedReportDraft({
    claim: { claim_number: "ULA-REG-NR-001", business_line: "Marine Cargo (Non-Reefer)" },
    documents: [{ id: "non-reefer-bundle", file_name: "Non-reefer claim bundle.pdf" }],
    versions: [],
    generatedBy: "Test Adjuster",
    analysis,
    evidence,
  });
  const record = draft.normalizedRecord;
  const data = buildMasterReportData({
    report: { normalized_claim_record: record, status: "Draft", assignments: draft.assignments },
    claim: { business_line: "Marine Cargo (Non-Reefer)" },
    issueDate: "29 August 2026",
  });

  assert.equal(record.financials.itemized_claim_total, 471.40);
  assert.equal(record.adjustment.line_items.length, 3);
  assert.equal(record.financials.valuation_uplift_amount, 47.14);
  assert.equal(record.financials.deductible, 250);
  assert.equal(record.financials.provisional_indemnity, 268.54);
  assert.equal(record.financials.concluded_indemnity, null);
  assert.equal(record.financials.arithmetic_valid, false);
  assert.deepEqual(record.chronology.map((event) => event.field), [
    "policy_inception_date", "packing_list_date", "invoice_date", "departure_date", "shipment_date",
  ]);
  assert.equal(record.facts.quantity.status, "conflict");
  assert.equal(record.facts.affected_quantity.status, "conflict");
  assert.ok(record.conflicts.some((item) => item.field === "quantity"));
  assert.ok(record.conflicts.some((item) => item.field === "affected_quantity"));
  assert.doesNotMatch(JSON.stringify(record.validation_checks), /30,261|1,045,915/);
  assert.equal(record.facts.policy_warranties.value, null);
  assert.equal(record.facts.policy_exclusions.value, null);
  assert.equal(record.cause_assessment.explicit_cause, null);
  assert.equal(record.cause_assessment.assessment_level, "provisional_evidence_based_opinion");
  assert.ok(!record.cause_assessment.hypotheses.some((item) => /sealed transit|pre-shipment quantity/i.test(item.hypothesis)));
  assert.match(data.paragraphs.cause_of_loss_section[0], /not expressly established as a source fact/i);
  assert.match(data.paragraphs.cause_of_loss_section.join(" "), /consistent with handling impact or cargo movement/i);
  assert.match(data.paragraphs.conclusion_items[0], /cannot be stated as fair & reasonable/i);
  assert.doesNotMatch(data.paragraphs.conclusion_items[0], /USD 471\.40 is considered fair/i);
  assert.doesNotMatch(data.paragraphs.report_summary_opinion.join(" "), /471\.\s+40/);
  assert.match(data.paragraphs.conclusion_items[2], /deductible and valuation provision may apply/i);
  assert.doesNotMatch(data.paragraphs.conclusion_items[2], /claimed quantity is covered/i);
  assert.match(data.scalars.transport_document, /^Bill of Lading: Not established/i);
  assert.match(data.scalars.summary_assured, /Example Imports Ltd \(Assured\).*Example Export Cooperative \(Shipper\)/i);
  assert.match(data.paragraphs.report_summary_intro[1], /Example Imports Ltd as the Assured.*Example Export Cooperative as the shipper/i);
  assert.equal(data.scalars.approval_date, "Pending professional approval");
  assert.doesNotMatch(data.scalars.policy_details, /Warranted Independent Satisfactory Pre-Shipment Loading, Stowage,|Excluded Countries Clause: This Policy does not Cover Shipments To and\/or/i);
  assert.doesNotMatch(JSON.stringify(data.paragraphs), /\(Source:/);
});

test("policy OCR fragments with broken words or unmatched parentheses are withheld", () => {
  const source = (supportingText, page) => ({
    document_id: "fragmented-policy",
    document_name: "policy.pdf",
    page,
    supporting_text: supportingText,
    confidence: 0.98,
    evidence_mode: "extracted_text",
  });
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    extracted_fields: [{
      field: "policy_warranties",
      value: "Warranted immediate notice of any claim under this pol",
      normalized_value: "Warranted immediate notice of any claim under this pol",
      confidence: 0.98,
      requires_confirmation: false,
      sources: [source("Warranted immediate notice of any claim under this pol", 2)],
    }, {
      field: "policy_exclusions",
      value: "excluding beverages) City LONDONGATEWAY",
      normalized_value: "excluding beverages) City LONDONGATEWAY",
      confidence: 0.98,
      requires_confirmation: false,
      sources: [source("excluding beverages) City LONDONGATEWAY", 3)],
    }],
    document_types: [],
    evidence_findings: [],
    missing_documents: [],
    warnings: [],
    human_review_required: [],
  };
  const record = createUnifiedReportDraft({
    claim: { business_line: "Marine Cargo (Non-Reefer)" },
    documents: [],
    versions: [],
    generatedBy: "Test",
    analysis,
    evidence: [],
  }).normalizedRecord;

  assert.equal(record.facts.policy_warranties.value, null);
  assert.equal(record.facts.policy_exclusions.value, null);
  assert.ok(record.conflicts.some((item) => item.field === "policy_warranties"));
  assert.ok(record.conflicts.some((item) => item.field === "policy_exclusions"));
});

test("an aggregate claim row is not added again to its detailed adjusted schedule", () => {
  const source = {
    document_id: "adjustment-schedule",
    document_name: "claim-schedule.pdf",
    page: 4,
    supporting_text: "Claimed damage value 16,068; adjusted detailed items 13,552.80",
    confidence: 0.99,
    evidence_mode: "extracted_text",
  };
  const field = (name, value) => ({
    field: name,
    value: String(value),
    normalized_value: String(value),
    confidence: 0.99,
    requires_confirmation: false,
    sources: [source],
  });
  const line = (description, adjustedValue) => ({
    description,
    quantity: "1",
    unit_price: adjustedValue,
    adjusted_value: adjustedValue,
    currency: "USD",
    basis: "Claim schedule",
    confidence: 0.99,
    sources: [source],
  });
  const analysis = {
    business_line: "Marine Cargo (Non-Reefer)",
    extracted_fields: [field("claim_amount", 16068), field("adjusted_amount", 13552.8), field("deductible", 0), field("currency", "USD")],
    adjustment_line_items: [
      line("Claimed damage value per claimant schedule", 16068),
      line("Damaged product group A", 7000),
      line("Damaged product group B", 6552.8),
    ],
    document_types: [],
    evidence_findings: [],
    missing_documents: [],
    warnings: [],
    human_review_required: [],
  };
  const record = createUnifiedReportDraft({
    claim: { business_line: "Marine Cargo (Non-Reefer)" },
    documents: [],
    versions: [],
    generatedBy: "Test",
    analysis,
    evidence: [],
  }).normalizedRecord;

  assert.equal(record.adjustment.line_items.length, 2);
  assert.equal(record.financials.itemized_claim_total, 13552.8);
  assert.equal(record.financials.presented_claim, 16068);
  assert.equal(record.financials.adjusted_claim_amount, 13552.8);
  assert.equal(record.financials.concluded_indemnity, 13552.8);
  assert.equal(record.financials.calculation_status, "validated");
  assert.ok(record.conflicts.some((item) => item.field === "adjustment_line_items" && /counted twice/i.test(item.message)));
});
