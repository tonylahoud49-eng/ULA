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
import { selectReportPhotographs } from "../../src/lib/reportPhotoSelection.js";
import { SYSTEM_INSTRUCTIONS } from "../ai/providers/openaiProvider.mjs";

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
  assert.match(xml, /We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions\./i);
  assert.doesNotMatch(xml, /The following was concluded:|End of adjustment note\./i);
  assert.doesNotMatch(xml, /Human review required/i);
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
  const preferred = Array.from({ length: 8 }, (_, index) => ({
    document_id: "survey-photos",
    document_name: "claim-survey-and-photographs.pdf",
    page: index + 1,
    caption: `Material view ${index + 1}`,
  }));
  const images = preferred.map((item, index) => ({ ...item, data: new Uint8Array([index + 1, 2, 3, 4]) }));
  images.splice(2, 0, { ...preferred[0], page: 99, data: images[0].data, caption: "Duplicate bytes" });
  const selected = selectReportPhotographs(images, preferred);
  assert.equal(selected.length, 6);
  assert.equal(selected.filter((item) => item.data === images[0].data).length, 1);
  assert.ok(selected.every((item) => /Material view/.test(item.caption)));
});
