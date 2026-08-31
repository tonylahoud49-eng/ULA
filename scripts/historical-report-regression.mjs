import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { loadApprovedStyleReferences } from "../server/ai/referenceLayer.mjs";
import { anthropicProviderInternals, createAnthropicProvider } from "../server/ai/providers/anthropicProvider.mjs";
import { extractEvidenceFile } from "../server/evidence/extractEvidence.mjs";
import { mapAnalysis } from "../src/api/aiAnalysisClient.js";
import { populateMasterReportDocx } from "../src/lib/masterReportDocx.js";
import { createUnifiedReportDraft } from "../src/lib/reportingEngine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifest = path.join(root, ".tmp", "historical-regression", "manifest.json");
const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split("=");
  return [key.replace(/^--/, ""), value.join("=") || true];
}));
const phase = String(args.get("phase") || "before");
const replayFrom = args.get("replay-from") ? String(args.get("replay-from")) : null;
const manifestPath = path.resolve(String(args.get("manifest") || defaultManifest));
const selectedCase = args.get("case") ? String(args.get("case")) : null;
const outputRoot = path.join(root, ".tmp", "historical-regression", phase);
const evidenceCache = path.join(root, ".tmp", "historical-regression", "evidence-cache");

const decodeXml = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));

const xmlText = (xml) => decodeXml([...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1]).join(""))
  .replace(/\s+/g, " ")
  .trim();

const canonicalHeading = (text) => {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const tests = [
    ["report_summary", /report summary/i],
    ["report_note", /report and adjustment note/i],
    ["interest_insured", /interest insured/i],
    ["shipment_routing", /shipment routing/i],
    ["surveyor_notes", /surveyor notes/i],
    ["cause", /cause of loss/i],
    ["policy", /relevant policy|policy conditions|policy terms|warrant/i],
    ["liability", /liability|recovery/i],
    ["adequacy", /adequacy of sum insured/i],
    ["assessors", /appointment of assessors/i],
    ["adjustment", /claim presented|adjustment/i],
    ["conclusion", /^conclusion/i],
    ["enclosures", /enclosure/i],
    ["outstanding", /outstanding/i],
    ["appendix", /appendix/i],
  ];
  return tests.find(([, pattern]) => pattern.test(value))?.[0] || null;
};

async function inspectDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const paragraphs = [...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((match) => ({
      text: xmlText(match[0]),
      style: match[0].match(/<w:pStyle\s+w:val="([^"]+)"/i)?.[1] || "",
    }))
    .filter((item) => item.text);
  const sections = {};
  let active = "front_matter";
  for (const paragraph of paragraphs) {
    const heading = canonicalHeading(paragraph.text);
    if (heading && (/heading|title|toc/i.test(paragraph.style) || paragraph.text.length < 100)) active = heading;
    if (!sections[active]) sections[active] = [];
    sections[active].push(paragraph.text);
  }
  const text = paragraphs.map((item) => item.text).join("\n");
  const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  return {
    paragraph_count: paragraphs.length,
    word_count: text.split(/\s+/).filter(Boolean).length,
    media_count: media.length,
    heading_order: Object.keys(sections).filter((key) => key !== "front_matter"),
    sections: Object.fromEntries(Object.entries(sections).map(([key, values]) => [key, values.join("\n")])),
    metrics: textMetrics(text),
  };
}

function textMetrics(text) {
  const value = String(text || "");
  return {
    source_citations: (value.match(/\b(?:Source|Evidence)\s*:/gi) || []).length,
    page_references: (value.match(/\bp(?:age|\.)?\s*\d+\b/gi) || []).length,
    unresolved_markers: (value.match(/requires confirmation|not established from the reviewed evidence/gi) || []).length,
    money_values: [...new Set((value.match(/\b(?:USD|EUR|GBP|AED|LBP|SAR|QAR|CAD|CHF|\$|€|£)\s*[\d,.]+/gi) || []).map((item) => item.replace(/\s+/g, " ")))].length,
    cause_terms: (value.match(/proximate|mechanism|caus(?:e|al|ation)|inherent vice|fortuitous/gi) || []).length,
    coverage_terms: (value.match(/policy|clause|warrant|exclusion|condition|coverage/gi) || []).length,
    calculation_terms: (value.match(/deductible|excess|salvage|recovery|depreciation|uplift|adjusted|indemnity|quantum/gi) || []).length,
    evidence_terms: (value.match(/evidence|document|invoice|certificate|bill of lading|air waybill|survey|photograph/gi) || []).length,
    professional_terms: (value.match(/we (?:note|consider|understand|confirm)|in our opinion|subject to|accordingly|nevertheless|therefore/gi) || []).length,
  };
}

const metricDelta = (approved, generated) => Object.fromEntries(
  Object.keys(approved).map((key) => [key, generated[key] - approved[key]]),
);

function reportDifferences(approved, generated) {
  const approvedHeadings = new Set(approved.heading_order);
  const generatedHeadings = new Set(generated.heading_order);
  return {
    missing_approved_sections: approved.heading_order.filter((heading) => !generatedHeadings.has(heading)),
    additional_generated_sections: generated.heading_order.filter((heading) => !approvedHeadings.has(heading)),
    heading_order_matches: approved.heading_order.join("|") === generated.heading_order.join("|"),
    word_count_delta: generated.word_count - approved.word_count,
    media_count_delta: generated.media_count - approved.media_count,
    narrative_metric_delta: metricDelta(approved.metrics, generated.metrics),
  };
}

function analysisQuality(analysis) {
  const findings = analysis.evidence_findings || [];
  const domainCounts = findings.reduce((counts, finding) => {
    const domain = finding.analysis_domain || "general";
    counts[domain] = (counts[domain] || 0) + 1;
    return counts;
  }, {});
  return {
    finding_count: findings.length,
    domain_counts: domainCounts,
    covered_professional_domains: Object.keys(domainCounts).filter((domain) => domain !== "general"),
    cited_finding_count: findings.filter((finding) => (finding.sources || []).length > 0).length,
    multi_source_finding_count: findings.filter((finding) => (finding.sources || []).length > 1).length,
    warning_count: (analysis.warnings || []).length,
    human_review_item_count: (analysis.human_review_required || []).length,
  };
}

const serializableEvidence = (evidence) => evidence.map((item) => ({
  ...item,
  vision_images: (item.vision_images || []).map(({ buffer: _buffer, ...image }) => image),
  embedded_images: (item.embedded_images || []).map(({ buffer: _buffer, ...image }) => image),
}));

async function loadEvidence(caseDefinition) {
  await fs.mkdir(evidenceCache, { recursive: true });
  const sourcePath = path.resolve(caseDefinition.source_document);
  const cachePath = path.join(evidenceCache, `${caseDefinition.case_id}.json`);
  let sourceStats;
  let sourceBuffer;
  try {
    [sourceStats, sourceBuffer] = await Promise.all([fs.stat(sourcePath), fs.readFile(sourcePath)]);
  } catch (error) {
    if (!replayFrom) throw error;
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
    return { evidence: cached.evidence, sourceBuffer: Buffer.alloc(0), replayed_from_cache: true };
  }
  const evidence = await extractEvidenceFile({
    originalname: path.basename(sourcePath),
    mimetype: "application/pdf",
    size: sourceBuffer.length,
    buffer: sourceBuffer,
  }, {
    id: `${caseDefinition.case_id}-source`,
    file_name: path.basename(sourcePath),
    category: "Other",
    index: 0,
  });
  await fs.writeFile(cachePath, `${JSON.stringify({ source_mtime: sourceStats.mtimeMs, evidence: serializableEvidence([evidence])[0] }, null, 2)}\n`);
  return { evidence, sourceBuffer };
}

const appendixImages = (evidence, normalizedRecord) => {
  const preferred = new Set((normalizedRecord.selected_photographs || []).map((item) => `${item.document_id}:${item.page}`));
  const available = evidence.flatMap((document) => (document.vision_images || []).filter((item) => item.buffer).map((item) => ({ document, item })));
  const selected = preferred.size
    ? available.filter(({ document, item }) => preferred.has(`${document.document_id}:${item.page}`))
    : available;
  return selected.slice(0, 12).map(({ document, item }) => ({
    data: new Uint8Array(item.buffer),
    content_type: item.mime_type,
    extension: item.mime_type === "image/jpeg" ? "jpg" : "png",
    document_id: document.document_id,
    document_name: document.document_name,
    page: item.page,
  }));
};

async function runCase(caseDefinition, provider, styleReferences, template) {
  const caseDirectory = path.join(outputRoot, caseDefinition.case_id);
  await fs.mkdir(caseDirectory, { recursive: true });
  let savedResult = null;
  let savedMapped = null;
  let savedComparison = null;
  if (replayFrom) {
    const replayDirectory = path.join(root, ".tmp", "historical-regression", replayFrom, caseDefinition.case_id);
    try {
      [savedResult, savedMapped, savedComparison] = await Promise.all([
        fs.readFile(path.join(replayDirectory, "provider-result.json"), "utf8").then(JSON.parse),
        fs.readFile(path.join(replayDirectory, "mapped-analysis.json"), "utf8").then(JSON.parse),
        fs.readFile(path.join(replayDirectory, "comparison.json"), "utf8").then(JSON.parse),
      ]);
    } catch {
      throw new Error(`No saved successful analysis is available in replay phase ${replayFrom}.`);
    }
  }
  const { evidence, sourceBuffer } = await loadEvidence(caseDefinition);
  if (phase === "before") {
    evidence.vision_images = (evidence.vision_images || []).filter((item) => item.vision_reason !== "material-raster-with-searchable-text");
    evidence.vision_image_count = evidence.vision_images.length;
  }
  const sourcePath = path.resolve(caseDefinition.source_document);
  const claim = {
    id: `historical-regression-${caseDefinition.case_id}`,
    claim_number: caseDefinition.case_id,
    business_line: "Unclassified",
    status: "New",
  };
  const files = [{
    originalname: path.basename(sourcePath),
    mimetype: "application/pdf",
    size: sourceBuffer.length,
    buffer: sourceBuffer,
  }];
  const result = replayFrom
    ? structuredClone(savedResult)
    : await provider.analyze({ claim, evidence: [evidence], files, styleReferences });
  result.evidence_snapshot = serializableEvidence([evidence]);
  const mapped = replayFrom ? structuredClone(savedMapped) : mapAnalysis(result);
  if (replayFrom && ["Requires Review", "Other / Requires Review"].includes(mapped.business_line)) {
    const recoveredClassification = anthropicProviderInternals.deterministicBusinessLine([evidence]);
    if (recoveredClassification) {
      result.analysis.classification = recoveredClassification;
      mapped.business_line = recoveredClassification.business_line;
      mapped.confidence = recoveredClassification.confidence;
      mapped.classification_rationale = recoveredClassification.rationale;
    }
  }
  const documents = [{
    id: evidence.document_id,
    file_name: evidence.document_name,
    file_mime_type: evidence.mime_type,
    file_type: "Other",
    category: "Other",
    detected_categories: mapped.document_types
      .filter((item) => item.sources.some((source) => source.document_id === evidence.document_id))
      .map((item) => item.document_type),
  }];
  const enrichedClaim = {
    ...claim,
    ai_analysis: mapped,
    ai_suggested_business_line: mapped.business_line,
  };
  const draft = createUnifiedReportDraft({
    claim: enrichedClaim,
    documents,
    versions: [],
    generatedBy: "Historical regression",
    analysis: mapped,
    evidence: serializableEvidence([evidence]),
  });
  const report = {
    ...draft,
    claim_number: caseDefinition.case_id,
    normalized_claim_record: draft.normalizedRecord,
    version_number: 1,
    issue_state: "Regression draft",
  };
  const generatedDocx = await populateMasterReportDocx(template, {
    claim: enrichedClaim,
    report,
    issueDate: "Historical regression",
  }, { appendixImages: appendixImages([evidence], draft.normalizedRecord) });
  let approvedInspection;
  try {
    approvedInspection = await fs.readFile(path.resolve(caseDefinition.approved_report)).then(inspectDocx);
  } catch (error) {
    if (!replayFrom || !savedComparison?.approved) throw error;
    approvedInspection = savedComparison.approved;
  }
  const generatedInspection = await inspectDocx(generatedDocx);
  const comparison = {
    case_id: caseDefinition.case_id,
    source_document: path.basename(sourcePath),
    approved_report: path.basename(caseDefinition.approved_report),
    classification: result.analysis.classification,
    document_types: result.analysis.document_types.map((item) => item.document_type),
    missing_documents: result.analysis.missing_documents.map((item) => item.document_type),
    normalized_outstanding_documents: draft.normalizedRecord.outstanding_documents,
    analysis_quality: analysisQuality(result.analysis),
    evidence_extraction: {
      page_count: evidence.pages.length,
      searchable_pages: evidence.searchable_page_count,
      image_only_pages: evidence.image_only_page_count,
      visual_pages_sent: evidence.vision_image_count,
    },
    approved: approvedInspection,
    generated: generatedInspection,
    differences: reportDifferences(approvedInspection, generatedInspection),
  };
  await Promise.all([
    fs.writeFile(path.join(caseDirectory, "provider-result.json"), `${JSON.stringify(result, null, 2)}\n`),
    fs.writeFile(path.join(caseDirectory, "mapped-analysis.json"), `${JSON.stringify(mapped, null, 2)}\n`),
    fs.writeFile(path.join(caseDirectory, "normalized-record.json"), `${JSON.stringify(draft.normalizedRecord, null, 2)}\n`),
    fs.writeFile(path.join(caseDirectory, "generated-report.md"), draft.content),
    fs.writeFile(path.join(caseDirectory, "generated-report.docx"), generatedDocx),
    fs.writeFile(path.join(caseDirectory, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`),
  ]);
  return comparison;
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const cases = manifest.cases.filter((item) => !selectedCase || item.case_id === selectedCase);
if (!cases.length) throw new Error(`No regression case matched ${selectedCase || manifestPath}.`);
if (!replayFrom && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for historical regression.");
await fs.mkdir(outputRoot, { recursive: true });
const provider = replayFrom ? null : createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL,
  maxOutputTokens: process.env.ANTHROPIC_MAX_OUTPUT_TOKENS,
  verifiedClassificationRecovery: phase !== "before",
});
const styleReferences = replayFrom ? [] : await loadApprovedStyleReferences(
  process.env.ULA_REPORT_REFERENCE_DIR || path.join(root, "server", "ai", "references"),
);
const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
const comparisons = [];
for (const caseDefinition of cases) {
  process.stdout.write(`[${phase}] ${caseDefinition.case_id}: ${replayFrom ? `replaying saved ${replayFrom} analysis locally` : "analyzing"}...\n`);
  try {
    comparisons.push(await runCase(caseDefinition, provider, styleReferences, template));
    process.stdout.write(`[${phase}] ${caseDefinition.case_id}: complete\n`);
  } catch (error) {
    comparisons.push({ case_id: caseDefinition.case_id, error: error.message, stack: error.stack });
    process.stderr.write(`[${phase}] ${caseDefinition.case_id}: ${error.message}\n`);
  }
  await fs.writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(comparisons, null, 2)}\n`);
}

const failures = comparisons.filter((item) => item.error);
process.stdout.write(`[${phase}] ${comparisons.length - failures.length}/${comparisons.length} cases completed.\n`);
if (failures.length) process.exitCode = 1;
