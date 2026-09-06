import crypto from "node:crypto";
import { z } from "zod";
import {
  ANALYSIS_DOMAINS,
  BUSINESS_LINES,
  CLAIM_FIELDS,
  DOCUMENT_TYPES,
  EVIDENCE_MODES,
  claimAnalysisSchema,
} from "../claimAnalysisSchema.mjs";
import { safeAiDebugLog, safeAiDiagnosticLog } from "../debugLog.mjs";
import { sanitizeReferenceNarrative } from "../referenceLayer.mjs";
import { enforceAnalysisCoverage } from "../analysisCoverage.mjs";
import { SYSTEM_INSTRUCTIONS, promptText } from "./openaiProvider.mjs";
import {
  prepareClaimContextForAnthropic,
  prepareEvidenceForAnthropic,
} from "../../evidence/prepareAnthropicEvidence.mjs";
import { calculateAiUsage } from "../billingCalculator.mjs";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_OUTPUT_TOKENS = 12_000;
const MAX_SONNET_4_6_OUTPUT_TOKENS = 64_000;
const SONNET_4_6_THINKING_BUDGET_TOKENS = 2_500;
const ANTHROPIC_LOSS_ADJUSTER_REASONING_PROTOCOL = `Claude loss-adjuster decision workflow:
1. Use the bounded internal thinking budget efficiently to investigate the complete current claim before encoding any output. First establish the evidence record page by page; then reason from that record. Commit to the strongest supported analysis and do not repeatedly revisit a decision unless contrary evidence requires it. Do not expose private reasoning or intermediate notes.
2. Build an internal party-role, document, chronology, routing, custody, quantity, condition, policy, and financial matrix. Resolve repeated facts and preserve genuine conflicts. Treat claim metadata as context only.
3. Reconcile the physical loss at the smallest supported unit. Distinguish shipped, delivered, claimed, counted, witnessed, damaged, missing, accepted, repairable, salvaged, and total-loss quantities. Identify who counted what, when, where, and in whose presence.
4. Perform a real causation analysis. Separate observation from mechanism and timing. Develop the viable causal hypotheses, test each against custody, physical consistency, contemporaneous records, supporting evidence, contrary evidence, and missing proof, then state the strongest proportionate professional opinion. A generic reported-cause label is not analysis.
5. Apply the actual current policy issue by issue. For each material clause, extension, warranty, condition, exclusion, limit, deductible, valuation term, and transit provision, pair the complete wording with the current fact that engages it or the precise missing fact. Explain its provisional significance while leaving final coverage approval reviewable.
6. Reconcile quantum and mitigation without doing the application's arithmetic. Identify the presented claim basis, supported damaged-item quantities and rates, valuation basis, provisional items, VAT/tax status, deductible terms, salvage, recovery, depreciation, and every mismatch or unsupported amount. Never substitute shipment value, insured value, quotation, or estimate for a presented claim.
7. Analyze liability and recovery party by party, including contractual role, custody stage, notice, admissions, defenses, time limits, and documents needed to preserve recovery. Do not assign liability from damage location or carrier involvement alone.
8. Before returning the structured result, conduct an adversarial senior-review audit: challenge the leading cause, coverage position, quantity scope, quantum basis, liable-party position, and every conclusion against competing evidence; check cross-section consistency; remove OCR contamination and generic filler; and ensure each material domain contains a cited fact-to-significance-to-conclusion finding.

The required product is the completed professional analysis, not a document extraction summary. Where evidence permits a qualified conclusion, give it with its basis, limitations, and alternatives. Where it does not, identify the exact evidence or decision needed and why it matters.`;
const ANTHROPIC_JSON_CONTRACT = `Return only the structured payload: no Markdown fences, preface, trailing commentary, or extra keys.
Confidence is 0..1. Exact values:
business_line=${JSON.stringify(BUSINESS_LINES)}
document_type=${JSON.stringify(DOCUMENT_TYPES)}
field=${JSON.stringify(CLAIM_FIELDS)}
evidence_mode=${JSON.stringify(EVIDENCE_MODES)}
analysis_domain=${JSON.stringify(ANALYSIS_DOMAINS)}
These transport rules override canonical null/page wording; the app restores canonical nulls. Return only top-level arrays sources and records. Register each citation once; records cite its zero-based source_refs index. Unknown page=0; never cite an invalid index.
Every record includes every schema key; use "", false, 0, or [] where inapplicable. Kinds:
- classification: key=business_line; text=rationale; confidence; source_refs.
- document_type: key=document_type; text=rationale; flag=sufficient_information; confidence; source_refs.
- field: key=field; value; normalized_value; flag=requires_confirmation; confidence; source_refs. Return only evidence-supported non-null field records; the app adds null fields.
- adjustment: text=description; quantity; unit_price; value=adjusted_value; currency; basis; confidence; source_refs. If quantity/conversion/rate are stated but no line total, preserve the expression/rate, leave value empty, and cite all inputs.
- missing_document: key=document_type; text=reason; details=missing_information.
- finding: key=analysis_domain; text=finding; confidence; source_refs. Use general only if no professional domain applies.
- summary, warning, review: complete item in text; other keys use defaults.
Return exactly one classification and one summary; other kinds may repeat. The payload has a hard limit of 48 sources and 64 records. Within that limit, prioritise one classification, one summary, up to 8 document types, 24 material fields, 12 adjustment lines, 8 material findings, and 6 decision-specific missing-document records. Add warning or review records only when they add a distinct material point. Reuse citations and consolidate repeated facts; do not produce a page-by-page extraction, duplicate records, or a record for an irrelevant schema field. Full page review is mandatory, but the structured payload must contain only the material result of that review.
Never omit a material claim finding, conflict, cause/coverage/liability/quantum/salvage/recovery issue. If evidence is extensive, preserve the strongest cited position for each distinct issue and combine only non-material supporting detail into that issue's concise finding.
Be concise: summary <=3 short sentences; rationale/basis/warning/review <=1 sentence and <=280 characters. A finding may use a compact analytical paragraph of up to 3 sentences and <=480 characters, linking facts, significance, alternatives and provisional assessment. Split distinct issues. Cite no more than two strong non-duplicate sources per record and both conflict sides where material. supporting_text is exact and <=180 characters. Return only detected document_types and required missing_documents.`;
const ANTHROPIC_SYSTEM_INSTRUCTIONS = `${SYSTEM_INSTRUCTIONS}

Calculation boundary: Claude understands documents and extracts source-stated financial inputs, but does not calculate claim totals. The application performs arithmetic, reconciliation, validation, and adjustment calculations.

${ANTHROPIC_LOSS_ADJUSTER_REASONING_PROTOCOL}

${ANTHROPIC_JSON_CONTRACT}`;

const REQUIRED_DOCUMENTS = {
  Yacht: ["Policy", "Claim Form", "Supporting Evidence", "Registration", "Repair Invoice or Quotation", "Survey Report", "Photographs"],
  Property: ["Policy", "Claim Form", "Supporting Evidence", "Incident Report", "Repair Invoice or Quotation", "Photographs", "Survey Report"],
  "Marine Cargo (Reefer/GFS)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Report"],
  "Marine Cargo (Non-Reefer)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Notice of Claim", "Survey Report"],
  "Bulk Vessel": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Cargo Certificate", "Survey Report"],
  "Air Shipment (NET)": ["Policy", "Claim Form", "Supporting Evidence", "Air Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
  "Land Shipment": ["Policy", "Claim Form", "Supporting Evidence", "Truck Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
  "Fidelity Claims": ["Policy", "Claim Form", "Supporting Evidence", "Employee Records", "Account Ledger", "Investigation Statement"],
  "Other / Requires Review": ["Policy", "Claim Form", "Supporting Evidence"],
};

const SUPPORTING_DOCUMENT_TYPES = new Set([
  "Survey Report", "Photographs", "Commercial Invoice", "Repair Invoice or Quotation", "Packing List",
  "Bill of Lading", "Air Waybill", "Truck Waybill", "Temperature Records", "Cargo Certificate",
  "Notice of Claim", "Incident Report", "Registration", "Employee Records", "Account Ledger",
  "Investigation Statement", "Correspondence",
]);

const closedObject = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const arrayOf = (items) => ({ type: "array", items });
const sourceOutputSchema = () => closedObject({
  document_id: { type: "string" },
  document_name: { type: "string" },
  page: { type: "integer" },
  supporting_text: { type: "string" },
  confidence: { type: "number" },
  evidence_mode: { type: "string" },
});

const recordOutputSchema = () => closedObject({
  kind: { type: "string" },
  key: { type: "string" },
  value: { type: "string" },
  normalized_value: { type: "string" },
  text: { type: "string" },
  quantity: { type: "string" },
  unit_price: { type: "string" },
  currency: { type: "string" },
  basis: { type: "string" },
  confidence: { type: "number" },
  flag: { type: "boolean" },
  source_refs: arrayOf({ type: "integer" }),
  details: arrayOf({ type: "string" }),
});

// Anthropic compiles this transport schema into a grammar. Keep only one copy
// of the citation shape and one generic record shape here; the application
// reconstructs and validates the unchanged canonical claim schema locally.
function structuredOutputSchema() {
  return closedObject({
    sources: arrayOf(sourceOutputSchema()),
    records: arrayOf(recordOutputSchema()),
  });
}

function measureJsonSchemaComplexity(schema) {
  const metrics = {
    serialized_bytes: Buffer.byteLength(JSON.stringify(schema)),
    property_occurrences: 0,
    object_nodes: 0,
    array_nodes: 0,
    union_nodes: 0,
    union_branches: 0,
  };
  const visit = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (Array.isArray(node.type)) {
      metrics.union_nodes += 1;
      metrics.union_branches += node.type.length;
    }
    if (node.type === "object") {
      metrics.object_nodes += 1;
      metrics.property_occurrences += Object.keys(node.properties || {}).length;
      Object.values(node.properties || {}).forEach(visit);
    }
    if (node.type === "array") {
      metrics.array_nodes += 1;
      visit(node.items);
    }
  };
  visit(schema);
  return metrics;
}

const TRANSPORT_RECORD_KINDS = [
  "classification",
  "document_type",
  "field",
  "adjustment",
  "missing_document",
  "finding",
  "summary",
  "warning",
  "review",
];

const TRANSPORT_KIND_ALIASES = new Map([
  ["classification", "classification"],
  ["document_type", "document_type"],
  ["document_types", "document_type"],
  ["documenttype", "document_type"],
  ["field", "field"],
  ["fields", "field"],
  ["adjustment", "adjustment"],
  ["adjustment_item", "adjustment"],
  ["adjustment_line_item", "adjustment"],
  ["adjustment_line_items", "adjustment"],
  ["missing_document", "missing_document"],
  ["missing_documents", "missing_document"],
  ["missingdocument", "missing_document"],
  ["finding", "finding"],
  ["evidence_finding", "finding"],
  ["coverage_finding", "finding"],
  ["liability_finding", "finding"],
  ["quantum_finding", "finding"],
  ["salvage_finding", "finding"],
  ["recovery_finding", "finding"],
  ["conflict", "finding"],
  ["summary", "summary"],
  ["warning", "warning"],
  ["warnings", "warning"],
  ["review", "review"],
  ["human_review", "review"],
  ["human_review_item", "review"],
  ["human_review_required", "review"],
]);

const transportKindFingerprint = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const normalizeTransportConfidence = (value) => Number.isInteger(value) && value >= 10 && value <= 100
  ? value / 100
  : value;

const NULLABLE_TRANSPORT_STRING_SLOTS = [
  "key",
  "value",
  "normalized_value",
  "text",
  "quantity",
  "unit_price",
  "currency",
  "basis",
];

function normalizeTransportRecord(record) {
  const normalized = { ...record };
  for (const slot of NULLABLE_TRANSPORT_STRING_SLOTS) {
    if (normalized[slot] === null) normalized[slot] = "";
  }
  if (normalized.confidence === null) normalized.confidence = 0;
  else normalized.confidence = normalizeTransportConfidence(normalized.confidence);
  if (normalized.flag === null) normalized.flag = false;
  if (normalized.source_refs === null) normalized.source_refs = [];
  if (normalized.details === null) normalized.details = [];
  const fingerprint = transportKindFingerprint(normalized.kind);
  normalized.kind = TRANSPORT_KIND_ALIASES.get(fingerprint) || normalized.kind;
  return normalized;
}

function normalizeAnthropicTransportShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    sources: Array.isArray(value.sources)
      ? value.sources.map((source) => source && typeof source === "object" && !Array.isArray(source)
        ? {
            ...source,
            page: source.page === null ? 0 : source.page,
            confidence: source.confidence === null ? 0 : normalizeTransportConfidence(source.confidence),
          }
        : source)
      : value.sources,
    records: Array.isArray(value.records)
      ? value.records.map((record) => {
          if (!record || typeof record !== "object" || Array.isArray(record)) return record;
          return normalizeTransportRecord(record);
        })
      : value.records,
  };
}

const anthropicTransportSourceSchema = z.object({
  document_id: z.string(),
  document_name: z.string(),
  page: z.number().int(),
  supporting_text: z.string(),
  confidence: z.number().min(0).max(1),
  evidence_mode: z.string(),
}).strict();

const anthropicTransportRecordSchema = z.object({
  kind: z.enum(TRANSPORT_RECORD_KINDS),
  key: z.string(),
  value: z.string(),
  normalized_value: z.string(),
  text: z.string(),
  quantity: z.string(),
  unit_price: z.string(),
  currency: z.string(),
  basis: z.string(),
  confidence: z.number().min(0).max(1),
  flag: z.boolean(),
  source_refs: z.array(z.number().int().nonnegative()),
  details: z.array(z.string()),
}).strict();

const anthropicTransportSchema = z.object({
  sources: z.array(anthropicTransportSourceSchema),
  records: z.array(anthropicTransportRecordSchema),
}).strict();

const emptyToNull = (value) => value === "" ? null : value;

function reconstructCanonicalAnalysis(transport) {
  const recordsOf = (kind) => transport.records.filter((record) => record.kind === kind);
  const reconstructionWarnings = [];
  const reconstructionReviews = [];
  let discardedSourceRefs = 0;
  const sourcesFor = (record) => record.source_refs.map((sourceIndex) => {
    const source = transport.sources[sourceIndex];
    if (!source) {
      discardedSourceRefs += 1;
      return null;
    }
    const evidenceMode = canonicalEnumValue(source.evidence_mode, EVIDENCE_MODES);
    if (!EVIDENCE_MODES.includes(evidenceMode)) {
      discardedSourceRefs += 1;
      return null;
    }
    return {
      ...source,
      page: source.page <= 0 ? null : source.page,
      evidence_mode: evidenceMode,
    };
  }).filter(Boolean).filter((source, index, sources) => sources.findIndex((candidate) =>
    candidate.document_id === source.document_id
      && candidate.page === source.page
      && candidate.supporting_text === source.supporting_text) === index);

  const canonicalRecordKey = (record, allowed) => canonicalEnumValue(record.key, allowed);
  const knownRecords = (kind, allowed) => recordsOf(kind).flatMap((record) => {
    const key = canonicalRecordKey(record, allowed);
    if (!allowed.includes(key)) return [];
    return [{ ...record, key }];
  });
  const classificationRecords = knownRecords("classification", BUSINESS_LINES);
  const classificationCandidates = [...new Set(classificationRecords.map((record) => record.key))];
  let classification;
  if (classificationCandidates.length === 1) {
    const matching = classificationRecords.filter((record) => record.key === classificationCandidates[0]);
    classification = {
      business_line: classificationCandidates[0],
      confidence: Math.min(...matching.map((record) => record.confidence)),
      rationale: [...new Set(matching.map((record) => record.text).filter(Boolean))].join(" "),
      sources: matching.flatMap(sourcesFor),
    };
    if (matching.length > 1) {
      reconstructionWarnings.push("Claude returned duplicate matching classification records; their rationales and citations were merged locally.");
    }
  } else {
    const detail = classificationCandidates.length
      ? `conflicting classification candidates (${classificationCandidates.join(", ")})`
      : "no recognized classification record";
    classification = {
      business_line: "Other / Requires Review",
      confidence: 0,
      rationale: `Claude returned ${detail}; classification requires human review.`,
      sources: classificationRecords.flatMap(sourcesFor),
    };
    reconstructionWarnings.push(`Claude returned ${detail}; no business line was selected locally.`);
    reconstructionReviews.push("Confirm the claim business line from the cited evidence before report issue.");
  }

  const summaryRecords = recordsOf("summary").map((record) => record.text.trim()).filter(Boolean);
  const summary = [...new Set(summaryRecords)].join(" ")
    || "Claude returned no claim summary; review the structured findings and source evidence.";
  if (summaryRecords.length !== 1) {
    reconstructionWarnings.push(summaryRecords.length
      ? "Claude returned multiple summary records; their distinct text was combined locally."
      : "Claude returned no non-empty summary record.");
  }

  const documentTypeRecords = knownRecords("document_type", DOCUMENT_TYPES);
  const fieldRecords = knownRecords("field", CLAIM_FIELDS);
  const missingDocumentRecords = knownRecords("missing_document", DOCUMENT_TYPES);
  const adjustmentRecords = recordsOf("adjustment").filter((record) => record.text.trim()
    && (record.value.trim() || (record.quantity.trim() && record.unit_price.trim())));
  const findingRecords = knownRecords("finding", ANALYSIS_DOMAINS).filter((record) => record.text.trim());
  const discardedKnownKeyRecords = recordsOf("document_type").length - documentTypeRecords.length
    + recordsOf("field").length - fieldRecords.length
    + recordsOf("missing_document").length - missingDocumentRecords.length
    + recordsOf("adjustment").length - adjustmentRecords.length
    + recordsOf("finding").length - findingRecords.length;
  if (discardedKnownKeyRecords) {
    reconstructionWarnings.push(`${discardedKnownKeyRecords} transport record(s) with unrecognized canonical keys were ignored locally.`);
  }

  const reconstructed = {
    classification,
    document_types: documentTypeRecords.map((record) => ({
      document_type: record.key,
      confidence: record.confidence,
      sufficient_information: record.flag,
      rationale: record.text,
      sources: sourcesFor(record),
    })),
    fields: fieldRecords.map((record) => ({
      field: record.key,
      value: emptyToNull(record.value),
      normalized_value: emptyToNull(record.normalized_value),
      confidence: record.confidence,
      requires_confirmation: record.flag,
      sources: sourcesFor(record),
    })),
    adjustment_line_items: adjustmentRecords.map((record) => ({
      description: record.text,
      quantity: emptyToNull(record.quantity),
      unit_price: emptyToNull(record.unit_price),
      adjusted_value: record.value,
      currency: emptyToNull(record.currency),
      basis: record.basis,
      confidence: record.confidence,
      sources: sourcesFor(record),
    })),
    missing_documents: missingDocumentRecords.map((record) => ({
      document_type: record.key,
      reason: record.text,
      missing_information: record.details,
    })),
    evidence_findings: findingRecords.map((record) => ({
      analysis_domain: record.key,
      finding: record.text,
      confidence: record.confidence,
      sources: sourcesFor(record),
    })),
    summary,
    warnings: [...recordsOf("warning").map((record) => record.text).filter(Boolean), ...reconstructionWarnings],
    human_review_required: [...recordsOf("review").map((record) => record.text).filter(Boolean), ...reconstructionReviews],
  };
  if (discardedSourceRefs) {
    reconstructed.warnings.push(`${discardedSourceRefs} invalid citation reference(s) were discarded locally; unsupported facts were withheld.`);
  }
  return reconstructed;
}

function resolveMaxOutputTokens(value, model = DEFAULT_MODEL) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_024) {
    throw new RangeError("ANTHROPIC_MAX_OUTPUT_TOKENS must be an integer of at least 1024.");
  }
  const maximum = /claude-(?:sonnet|opus)-(?:4-6|5)|claude-3-[57]-sonnet/i.test(model)
    ? MAX_SONNET_4_6_OUTPUT_TOKENS
    : DEFAULT_MAX_OUTPUT_TOKENS;
  if (parsed > maximum) {
    throw new RangeError(`ANTHROPIC_MAX_OUTPUT_TOKENS cannot exceed ${maximum} for ${model}.`);
  }
  return parsed;
}

function completeUnsupportedClaimFields(parsed) {
  const returnedFields = new Set(parsed.fields.map((field) => field.field));
  const unsupportedFields = CLAIM_FIELDS
    .filter((field) => !returnedFields.has(field))
    .map((field) => ({
      field,
      value: null,
      normalized_value: null,
      confidence: 0,
      requires_confirmation: true,
      sources: [],
    }));
  return { ...parsed, fields: [...parsed.fields, ...unsupportedFields] };
}

const normalizeForMatch = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/\p{M}/gu, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const CITATION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "document", "evidence", "for", "form",
  "from", "in", "is", "it", "of", "on", "or", "report", "that", "the", "this", "to", "was",
  "were", "with",
]);

const evidenceBodyText = (item) => (item.pages || [])
  .filter((part) => part.text)
  .map((part) => part.text)
  .join("\n\n")
  .trim();

function evidenceWindows(item, maxLines = 4) {
  const lines = evidenceBodyText(item).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const windows = [];
  for (let size = 1; size <= Math.min(maxLines, lines.length); size += 1) {
    for (let start = 0; start + size <= lines.length; start += 1) {
      windows.push(lines.slice(start, start + size).join("\n"));
    }
  }
  return windows;
}

const distinctiveTokens = (value) => [...new Set(normalizeForMatch(value).split(" ").filter((token) =>
  token && !CITATION_STOP_WORDS.has(token) && (token.length >= 3 || /\d/.test(token))))];

function repairedExtractedTextSource(source, evidence, referencedDocument) {
  const orderedEvidence = [referencedDocument, ...evidence]
    .filter((item, index, items) => item && items.indexOf(item) === index && evidenceBodyText(item));
  const normalizedExcerpt = normalizeForMatch(source.supporting_text);

  for (const item of orderedEvidence) {
    const exactWindow = evidenceWindows(item).find((window) => normalizeForMatch(window).includes(normalizedExcerpt));
    if (exactWindow) {
      return {
        ...source,
        document_id: item.document_id,
        document_name: item.document_name,
        supporting_text: exactWindow,
        evidence_mode: "extracted_text",
      };
    }
  }

  const sourceTokens = distinctiveTokens(source.supporting_text);
  if (sourceTokens.length < 3) return null;
  let best = null;
  for (const item of orderedEvidence) {
    for (const window of evidenceWindows(item)) {
      const windowTokens = new Set(distinctiveTokens(window));
      const matchedTokens = sourceTokens.filter((token) => windowTokens.has(token));
      const coverage = matchedTokens.length / sourceTokens.length;
      const anchoredMatches = matchedTokens.filter((token) => /\d/.test(token) || token.length >= 7).length;
      const score = coverage + Math.min(matchedTokens.length, 8) / 100
        + (item === referencedDocument ? 0.01 : 0);
      if (!best || score > best.score) best = { item, window, matchedTokens, coverage, anchoredMatches, score };
    }
  }

  const safelyGrounded = best
    && best.matchedTokens.length >= 3
    && best.anchoredMatches >= 1
    && (best.coverage >= 0.6 || (best.coverage >= 0.5 && best.matchedTokens.length >= 5));
  if (!safelyGrounded) return null;
  return {
    ...source,
    document_id: best.item.document_id,
    document_name: best.item.document_name,
    supporting_text: best.window,
    evidence_mode: "extracted_text",
  };
}

function findEvidenceDocument(source, evidence) {
  if (!source) return null;
  const sourceId = normalizeForMatch(source.document_id);
  const sourceName = normalizeForMatch(source.document_name);
  return evidence.find((item) => item.document_id === source.document_id)
    || evidence.find((item) => {
      const id = normalizeForMatch(item.document_id);
      const name = normalizeForMatch(item.document_name);
      return (sourceId && (id === sourceId || name === sourceId))
        || (sourceName && (name === sourceName || name.includes(sourceName) || sourceName.includes(name)));
    })
    || null;
}

function verifiedSource(source, evidence) {
  if (!String(source?.supporting_text || "").trim()) return null;
  const referencedDocument = findEvidenceDocument(source, evidence);
  const repairedTextSource = repairedExtractedTextSource(source, evidence, referencedDocument);
  if (repairedTextSource) return repairedTextSource;

  if (source.evidence_mode === "extracted_text" || !referencedDocument) return null;
  const canBeViewed = referencedDocument.kind === "image"
    || referencedDocument.kind === "pdf"
    || (referencedDocument.embedded_images || []).length > 0;
  return canBeViewed
    ? { ...source, document_id: referencedDocument.document_id, document_name: referencedDocument.document_name }
    : null;
}

const evidenceExcerpt = (text, matchIndex, matchLength, maximum = 240) => {
  const source = String(text || "");
  const start = Math.max(0, matchIndex - Math.floor((maximum - matchLength) / 2));
  const end = Math.min(source.length, start + maximum);
  return source.slice(start, end).trim();
};

function groundedEvidenceMatch(evidence, pattern, confidence = 0.94) {
  for (const document of evidence) {
    for (const page of document.pages || []) {
      const text = String(page.text || "");
      const match = text.match(pattern);
      if (!match || match.index === undefined) continue;
      return {
        document_id: document.document_id,
        document_name: document.document_name,
        page: Number.isInteger(page.page) && page.page > 0 ? page.page : null,
        supporting_text: evidenceExcerpt(text, match.index, match[0].length),
        confidence,
        evidence_mode: "extracted_text",
      };
    }
  }
  return null;
}

function groundedEvidencePage(evidence, primaryPattern, corroboratingPatterns = [], confidence = 0.94) {
  for (const document of evidence) {
    for (const page of document.pages || []) {
      const pageText = String(page.text || "");
      const match = pageText.match(primaryPattern);
      if (!match || match.index === undefined) continue;
      if (corroboratingPatterns.length && corroboratingPatterns.filter((pattern) => pattern.test(pageText)).length < 2) continue;
      return {
        document_id: document.document_id,
        document_name: document.document_name,
        page: Number.isInteger(page.page) && page.page > 0 ? page.page : null,
        supporting_text: evidenceExcerpt(pageText, match.index, match[0].length),
        confidence,
        evidence_mode: "extracted_text",
      };
    }
  }
  return null;
}

const POLICY_REFERENCE_PATTERN = /\b(?:policy|cover\s*note)\s*(?:no\b\.?|number\b)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{4,})\b/ig;
const validPolicyReference = (value) => /^[A-Z0-9][A-Z0-9./-]{4,}$/i.test(String(value || "").trim())
  && /\d/.test(String(value || ""));
const policyReferencePriority = (pageText) => {
  const text = String(pageText || "");
  return (/\b(?:insurance\s+policy|policy\s+(?:schedule|wording|conditions|terms)|special\s+clauses|warrant(?:y|ies)|exclusions?)\b/i.test(text) ? 20 : 0)
    - (/\b(?:premium\s+advice|debit\s+note|credit\s+note|invoice|certificate|endorsement|claim\s+(?:no\.?|number))\b/i.test(text) ? 30 : 0);
};

function citedPolicyReferencePriority(source, evidence) {
  const document = findEvidenceDocument(source, evidence);
  if (!document) return null;
  const page = (document.pages || []).find((item) => item.page === source.page)
    || (document.pages || []).find((item) => String(item.text || "").includes(String(source.supporting_text || "")));
  return page ? policyReferencePriority(page.text) : null;
}

function deterministicPolicyNumber(evidence) {
  const candidates = [];
  for (const document of evidence) {
    for (const page of document.pages || []) {
      const pageText = String(page.text || "");
      POLICY_REFERENCE_PATTERN.lastIndex = 0;
      let match;
      while ((match = POLICY_REFERENCE_PATTERN.exec(pageText))) {
        const value = match[1].trim();
        if (!validPolicyReference(value)) continue;
        candidates.push({
          value,
          priority: policyReferencePriority(pageText),
          source: {
            document_id: document.document_id,
            document_name: document.document_name,
            page: Number.isInteger(page.page) && page.page > 0 ? page.page : null,
            supporting_text: evidenceExcerpt(pageText, match.index, match[0].length),
            confidence: 0.98,
            evidence_mode: "extracted_text",
          },
        });
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.priority - left.priority
    || left.source.document_id.localeCompare(right.source.document_id)
    || (left.source.page || 0) - (right.source.page || 0));
  const preferred = candidates[0];
  const equallyPreferredValues = new Set(candidates
    .filter((candidate) => candidate.priority === preferred.priority)
    .map((candidate) => candidate.value.toUpperCase()));
  if (equallyPreferredValues.size > 1) return { conflict: true, candidates };
  return preferred;
}

function deterministicDocumentTypes(evidence) {
  const transportDetails = [
    /\bshipper\b/i,
    /\bconsignee\b/i,
    /\bport\s+of\s+(?:loading|discharge)\b/i,
    /\bvessel\b/i,
    /\b(?:b\/?l|bill\s+of\s+lading)\s*(?:no\.?|number)\b/i,
  ];
  const airDetails = [
    /\bshipper\b/i,
    /\bconsignee\b/i,
    /\b(?:airport|flight)\b/i,
    /\b(?:awb|air\s*waybill)\s*(?:no\.?|number)?\b/i,
  ];
  const landDetails = [
    /\bconsignor\b/i,
    /\bconsignee\b/i,
    /\bcarrier\b/i,
    /\b(?:truck|vehicle|registration)\b/i,
  ];
  const definitions = [
    ["Policy", () => groundedEvidenceMatch(evidence, /(?:^|\n)\s*(?:(?:open\s+)?(?:marine|cargo|air\s+transit|property|fidelity)[^\n]{0,80}\s+)?insurance\s+policy\b|\bschedule\s+of\s+(?:particular\s+)?conditions\b/im, 0.96)],
    ["Bill of Lading", () => groundedEvidencePage(evidence, /\bbill\s+of\s+lading\b/i, transportDetails, 0.96)],
    ["Air Waybill", () => groundedEvidencePage(evidence, /\b(?:air\s*waybill|master\s+awb|house\s+awb)\b/i, airDetails, 0.96)],
    ["Truck Waybill", () => groundedEvidencePage(evidence, /\b(?:truck\s+waybill|cmr\s+consignment\s+note|international\s+consignment\s+note)\b/i, landDetails, 0.96)],
    ["Commercial Invoice", () => groundedEvidenceMatch(evidence, /(?:^|\n)\s*commercial\s+invoice\b/im, 0.96)],
    ["Packing List", () => groundedEvidenceMatch(evidence, /(?:^|\n)\s*packing\s+list\b|(?:^|\n)\s*item\s*,\s*package\s+mark\s*,\s*description\s*,[^\n]*\bnet\s+weight\b[^\n]*\bgross\s+weight\b/im, 0.96)],
    ["Notice of Claim", () => groundedEvidenceMatch(evidence, /(?:^|\n)\s*(?:notice\s+of\s+(?:cargo\s+)?(?:claim|loss|damage)|letter\s+of\s+reserve|intent\s+to\s+claim)\b/im, 0.96)],
    ["Survey Report", () => groundedEvidenceMatch(evidence, /(?:^|\n)\s*(?:preliminary\s+|final\s+)?(?:attendance\s+(?:and|&)\s+)?survey\s+report\b|(?:^|\n)\s*statement\s+of\s+facts\b/im, 0.96)],
  ];
  const detected = definitions.flatMap(([documentType, findSource]) => {
    const source = findSource();
    return source ? [{
      document_type: documentType,
      confidence: source.confidence,
      sufficient_information: true,
      rationale: `${documentType} content was recovered deterministically from the uploaded evidence.`,
      sources: [source],
    }] : [];
  });

  const claimSource = groundedEvidenceMatch(
    evidence,
    /(?:^|\n)\s*(?:notice\s+of\s+(?:cargo\s+)?claim(?:\s+(?:and|&)\s+claim\s+declaration)?\s+form|claim\s+declaration\s+form|claim\s+form|statement\s+of\s+claim)\b/im,
    0.94,
  );
  if (claimSource) {
    detected.push({
      document_type: "Claim Form",
      confidence: claimSource.confidence,
      sufficient_information: true,
      rationale: "Substantive current-claim declaration or presented-claim content was recovered from the uploaded evidence.",
      sources: [claimSource],
    });
  }
  return detected;
}

function deterministicBusinessLine(evidence) {
  const text = evidence.flatMap((document) => (document.pages || []).map((page) => page.text || "")).join("\n");
  const recoveredDocumentTypes = deterministicDocumentTypes(evidence);
  const sourceForDocumentType = (documentType) => recoveredDocumentTypes
    .find((item) => item.document_type === documentType)?.sources?.[0] || null;
  const specialistCandidates = [
    ["Air Shipment (NET)", sourceForDocumentType("Air Waybill")],
    ["Land Shipment", sourceForDocumentType("Truck Waybill")],
    ["Bulk Vessel", /\b(?:bulk\s+vessel|bulk\s+cargo|draft\s+survey)\b/i.test(text)
      && /\b(?:vessel|cargo\s+hold|hatch\s+cover|draft\s+survey)\b/i.test(text)
      ? groundedEvidenceMatch(evidence, /\b(?:bulk\s+vessel|bulk\s+cargo|draft\s+survey)\b/i)
      : null],
    ["Marine Cargo (Reefer/GFS)", /\b(?:(?:frozen|chilled|refrigerated)\s+(?:cargo|goods|products)|reefer\s+container)\b/i.test(text)
      && /\b(?:carrying\s+temperature|set\s*point|temperature\s+(?:recorder|logger)|data\s+logger)\b[^\n]{0,120}[-+]?\d+(?:\.\d+)?\s*(?:°|degrees?\s*)?[cf]\b/i.test(text)
      ? groundedEvidenceMatch(evidence, /\b(?:(?:frozen|chilled|refrigerated)\s+(?:cargo|goods|products)|reefer\s+container)\b/i)
      : null],
    ["Yacht", groundedEvidenceMatch(evidence, /\b(?:yacht\s+registration|pleasure\s+craft\s+policy|insured\s+yacht)\b/i)],
    ["Fidelity Claims", groundedEvidenceMatch(evidence, /\b(?:fidelity\s+claim|employee\s+theft|embezzlement|misappropriation)\b/i)],
    ["Property", groundedEvidenceMatch(evidence, /\b(?:property\s+claim|insured\s+premises|building\s+damage)\b/i)],
  ].filter(([, source]) => source);
  if (specialistCandidates.length > 1) return null;
  const specialist = specialistCandidates[0];
  if (specialist) {
    const [businessLine, source] = specialist;
    return source ? {
      business_line: businessLine,
      confidence: 0.94,
      rationale: `Current uploaded evidence expressly supports the ${businessLine} business line.`,
      sources: [source],
    } : null;
  }

  const billOfLading = recoveredDocumentTypes.find((item) => item.document_type === "Bill of Lading");
  const seaTransport = billOfLading
    && /\b(?:container|vessel|port\s+of\s+(?:loading|discharge)|shipped\s+on\s+board)\b/i.test(text);
  const marinePolicyTransportSource = seaTransport ? null : groundedEvidencePage(
    evidence,
    /\b(?:marine\s+(?:cargo\s+)?insurance\s+(?:policy|certificate)|branch\s*:?\s*marine(?:\s+cargo)?)\b/i,
    [
      /\b(?:means\s+of\s+conveyance|vessel(?:\s+name)?)\b/i,
      /\b(?:bill|b\/?l)\s*(?:no\.?|number)?\s*[:#]?\s*[A-Z0-9][A-Z0-9/-]{5,}\b/i,
      /\b[A-Z]{4}\d{7}\b/,
      /\bport\s+of\s+(?:loading|discharge)\b/i,
    ],
    0.92,
  );
  if (!seaTransport && !marinePolicyTransportSource) return null;
  if (/\b(?:(?:reefer|refrigerated)\s+(?:container|cargo|goods|products?)|(?:frozen|chilled)\s+(?:cargo|goods|products?)|temperature[- ]controlled)\b/i.test(text)
    && !specialistCandidates.some(([businessLine]) => businessLine === "Marine Cargo (Reefer/GFS)")) return null;
  const source = seaTransport ? billOfLading.sources[0] : marinePolicyTransportSource;
  return source ? {
    business_line: "Marine Cargo (Non-Reefer)",
    confidence: seaTransport ? 0.94 : 0.92,
    rationale: seaTransport
      ? "Current uploaded evidence establishes packaged or containerized sea carriage under a bill of lading."
      : "Current uploaded evidence independently establishes a marine cargo policy together with multiple sea-transport identifiers on the same source page.",
    sources: [source],
  } : null;
}

function classificationFromVerifiedDocumentTypes(parsedClassification, documentTypes) {
  const requiredDocumentType = new Map([
    ["Air Shipment (NET)", "Air Waybill"],
    ["Land Shipment", "Truck Waybill"],
    ["Marine Cargo (Non-Reefer)", "Bill of Lading"],
  ]).get(parsedClassification.business_line);
  if (!requiredDocumentType) return null;
  const supportingType = documentTypes.find((item) => item.document_type === requiredDocumentType
    && item.sufficient_information
    && item.sources.length);
  if (!supportingType) return null;
  return {
    ...parsedClassification,
    confidence: Math.min(parsedClassification.confidence, supportingType.confidence),
    rationale: `${parsedClassification.rationale} The proposed transport mode is independently supported by the verified ${requiredDocumentType} classification.`,
    sources: supportingType.sources,
  };
}

function enforceAnthropicGrounding(parsed, evidence, { verifiedClassificationRecovery = true } = {}) {
  const warnings = [...parsed.warnings];
  const verifySources = (sources) => (sources || []).map((source) => verifiedSource(source, evidence)).filter(Boolean);

  const documentTypes = parsed.document_types.flatMap((item) => {
    const sources = verifySources(item.sources);
    if (item.sufficient_information && !sources.length) {
      warnings.push(`${item.document_type} was not treated as present because Claude returned no verifiable source.`);
      return [];
    }
    return [{ ...item, sources }];
  });
  for (const recovered of deterministicDocumentTypes(evidence)) {
    if (documentTypes.some((item) => item.document_type === recovered.document_type && item.sufficient_information)) continue;
    documentTypes.push(recovered);
    warnings.push(`${recovered.document_type} was recovered deterministically from verifiable uploaded evidence after Claude omitted a usable document-type record.`);
  }
  if (!documentTypes.some((item) => item.document_type === "Policy" && item.sufficient_information)) {
    const policyFieldNames = new Set([
      "policy_number", "policy_period", "policy_terms", "policy_transit_scope", "policy_conveyance_limits",
      "policy_extensions", "policy_warranties", "policy_conditions", "policy_exclusions", "policy_limit",
      "insured_value", "valuation_basis", "valuation_uplift_percent", "deductible",
    ]);
    const verifiedPolicyFields = parsed.fields.flatMap((field) => {
      if (field.value === null || !policyFieldNames.has(field.field)) return [];
      const sources = verifySources(field.sources);
      return sources.length ? [{ field: field.field, confidence: field.confidence, sources }] : [];
    });
    const hasPolicyNumber = verifiedPolicyFields.some((field) => field.field === "policy_number");
    if (hasPolicyNumber && new Set(verifiedPolicyFields.map((field) => field.field)).size >= 2) {
      const sources = [...new Map(verifiedPolicyFields
        .flatMap((field) => field.sources)
        .map((source) => [`${source.document_id}:${source.page}:${source.supporting_text}`, source])).values()];
      documentTypes.push({
        document_type: "Policy",
        confidence: Math.min(0.96, Math.max(...verifiedPolicyFields.map((field) => field.confidence))),
        sufficient_information: true,
        rationale: "Substantive policy content was recovered from multiple verified policy-specific fields in the uploaded evidence.",
        sources: sources.slice(0, 4),
      });
      warnings.push("Policy was recovered from multiple verifiable policy-specific fields after Claude omitted a usable document-type record.");
    }
  }

  const directClassificationSources = verifySources(parsed.classification.sources);
  const deterministicClassification = !directClassificationSources.length
    && !/conflicting classification candidates/i.test(parsed.classification.rationale || "")
    ? deterministicBusinessLine(evidence)
    : null;
  const verifiedDocumentTypeClassification = !directClassificationSources.length
    && !deterministicClassification
    && verifiedClassificationRecovery
    && parsed.classification.business_line !== "Other / Requires Review"
    && !/conflicting classification candidates/i.test(parsed.classification.rationale || "")
    ? classificationFromVerifiedDocumentTypes(parsed.classification, documentTypes)
    : null;
  const classification = directClassificationSources.length
    ? { ...parsed.classification, sources: directClassificationSources }
    : deterministicClassification
      ? deterministicClassification
      : verifiedDocumentTypeClassification
        ? verifiedDocumentTypeClassification
      : {
        business_line: "Other / Requires Review",
        confidence: 0,
        rationale: "Claude did not return a verifiable evidence source for the classification.",
        sources: [],
      };
  if (deterministicClassification) {
    warnings.push("Claude omitted a usable classification record; the business line was recovered deterministically from verifiable uploaded evidence.");
  } else if (verifiedDocumentTypeClassification) {
    warnings.push("Claude's classification citation was unusable; the proposed business line and bounded confidence were retained from a separately verified transport-document classification.");
  } else if (!directClassificationSources.length) {
    warnings.push("The proposed classification was withheld because it had no verifiable source.");
  }

  const fields = parsed.fields.map((field) => {
    const sources = verifySources(field.sources);
    if (field.value !== null && !sources.length) {
      warnings.push(`${field.field.replaceAll("_", " ")} was withheld because Claude returned no verifiable source.`);
      return {
        ...field,
        value: null,
        normalized_value: null,
        confidence: 0,
        requires_confirmation: true,
        sources: [],
      };
    }
    return { ...field, sources, requires_confirmation: field.value === null || field.requires_confirmation };
  });
  const recoveredPolicyNumber = deterministicPolicyNumber(evidence);
  const policyNumberIndex = fields.findIndex((field) => field.field === "policy_number");
  const currentPolicyNumber = policyNumberIndex >= 0 ? fields[policyNumberIndex] : null;
  const currentPolicyPriority = currentPolicyNumber?.sources?.length
    ? Math.max(...currentPolicyNumber.sources
      .map((source) => citedPolicyReferencePriority(source, evidence))
      .filter((priority) => priority !== null))
    : null;
  const shouldRecoverPolicyNumber = recoveredPolicyNumber
    && (!currentPolicyNumber
      || !validPolicyReference(currentPolicyNumber.value)
      || (currentPolicyPriority !== null && currentPolicyPriority < recoveredPolicyNumber.priority));
  if (recoveredPolicyNumber?.conflict) {
    warnings.push("Multiple equally authoritative expressly labelled policy references were found; policy number remains subject to confirmation rather than selecting one silently.");
  } else if (shouldRecoverPolicyNumber) {
    const recoveredField = {
      field: "policy_number",
      value: recoveredPolicyNumber.value,
      normalized_value: recoveredPolicyNumber.value,
      confidence: recoveredPolicyNumber.source.confidence,
      requires_confirmation: false,
      sources: [recoveredPolicyNumber.source],
    };
    if (policyNumberIndex >= 0) fields[policyNumberIndex] = recoveredField;
    else fields.push(recoveredField);
    warnings.push("The policy number was recovered from an expressly labelled policy reference after Claude returned no usable or less authoritative policy identifier.");
  }

  const evidenceFindings = parsed.evidence_findings.flatMap((finding) => {
    const sources = verifySources(finding.sources);
    return sources.length ? [{ ...finding, sources }] : [];
  });
  const adjustmentLineItems = parsed.adjustment_line_items.flatMap((item) => {
    const sources = verifySources(item.sources);
    return sources.length ? [{ ...item, sources }] : [];
  });
  const supportingTypes = documentTypes.filter((item) => item.sufficient_information && SUPPORTING_DOCUMENT_TYPES.has(item.document_type));
  if (supportingTypes.length && !documentTypes.some((item) => item.document_type === "Supporting Evidence")) {
    documentTypes.push({
      document_type: "Supporting Evidence",
      confidence: Math.max(...supportingTypes.map((item) => item.confidence)),
      sufficient_information: true,
      rationale: "Claude identified content-grounded supporting material in the complete uploaded evidence set.",
      sources: supportingTypes.flatMap((item) => item.sources),
    });
  }

  const presentTypes = new Set(
    documentTypes.filter((item) => item.sufficient_information).map((item) => item.document_type),
  );
  const requiredDocuments = REQUIRED_DOCUMENTS[classification.business_line] || REQUIRED_DOCUMENTS["Other / Requires Review"];
  const requiredTypes = new Set(requiredDocuments);
  const missingDocuments = parsed.missing_documents.filter((item) =>
    requiredTypes.has(item.document_type) && !presentTypes.has(item.document_type));
  const missingTypes = new Set(missingDocuments.map((item) => item.document_type));
  for (const required of requiredDocuments) {
    if (presentTypes.has(required) || missingTypes.has(required)) continue;
    missingDocuments.push({
      document_type: required,
      reason: `Claude did not identify sufficient substantive ${required} information anywhere in the uploaded evidence set.`,
      missing_information: [`Substantive ${required} content requires confirmation.`],
    });
  }

  return {
    ...parsed,
    classification,
    document_types: documentTypes,
    fields,
    adjustment_line_items: adjustmentLineItems,
    missing_documents: missingDocuments,
    evidence_findings: evidenceFindings,
    warnings: [...new Set(warnings)],
  };
}

function providerError(status, body, requestId) {
  const details = body?.error?.message || body?.message || `Claude API request failed with HTTP ${status}.`;
  const type = body?.error?.type || body?.type;
  const error = new Error(type ? `${details} [${type}]` : details);
  error.status = status;
  error.providerStatus = status;
  error.providerRequestId = requestId || body?.request_id || null;
  error.isProviderError = true;
  return error;
}

function transportErrorMetadata(error) {
  const nestedErrors = Array.isArray(error?.cause?.errors) ? error.cause.errors : [];
  const directCause = error?.cause;
  const cause = directCause?.code ? directCause : nestedErrors[0] || directCause || (error?.code ? error : null);
  return {
    error_name: error?.name || null,
    error_message: error?.message || null,
    cause_name: cause?.name || null,
    cause_message: cause?.message || null,
    cause_code: cause?.code || null,
    nested_cause_codes: [...new Set(nestedErrors.map((item) => item?.code).filter(Boolean))],
  };
}

function networkError(error, { phase = "unknown", elapsedMs = null } = {}) {
  const metadata = transportErrorMetadata(error);
  const detail = metadata.cause_code || metadata.cause_message || metadata.error_message || "unknown network error";
  const wrapped = new Error(`Anthropic network request failed: ${error?.message || "fetch failed"} (${detail}).`);
  wrapped.cause = error;
  wrapped.isProviderError = true;
  wrapped.isNetworkError = true;
  wrapped.transportPhase = phase;
  wrapped.elapsedMs = elapsedMs;
  wrapped.causeCode = metadata.cause_code;
  return wrapped;
}

function logTransportFailure(error, context) {
  const metadata = { ...context, ...transportErrorMetadata(error) };
  safeAiDiagnosticLog("[ULA Anthropic transport failure]", metadata);
  return networkError(error, { phase: context.phase, elapsedMs: context.elapsed_ms });
}

function parseAnthropicEventStream(responseText) {
  let message = null;
  for (const frame of String(responseText || "").split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw new Error(`Anthropic returned an unreadable streaming event: ${error.message}`);
    }
    if (event.type === "error") return event;
    if (event.type === "message_start") {
      message = { ...event.message, content: [...(event.message?.content || [])] };
      continue;
    }
    if (!message) continue;
    if (event.type === "content_block_start") {
      message.content[event.index] = { ...event.content_block };
    } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const block = message.content[event.index] || { type: "text", text: "" };
      message.content[event.index] = { ...block, text: `${block.text || ""}${event.delta.text || ""}` };
    } else if (event.type === "message_delta") {
      Object.assign(message, event.delta || {});
      message.usage = { ...(message.usage || {}), ...(event.usage || {}) };
    }
  }
  return message || {};
}

function parseAnthropicResponseBody(responseText, contentType = "") {
  const isEventStream = contentType.toLowerCase().includes("text/event-stream")
    || /^\s*(?:event|data):/m.test(responseText);
  return isEventStream ? parseAnthropicEventStream(responseText) : JSON.parse(responseText || "{}");
}

const enumFingerprint = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/\p{M}/gu, "")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, "");

const canonicalEnumValue = (value, allowed) => {
  if (typeof value !== "string") return value;
  const fingerprint = enumFingerprint(value);
  return allowed.find((candidate) => enumFingerprint(candidate) === fingerprint) || value;
};

function normalizeAnthropicEnumCasing(value) {
  const parsed = structuredClone(value);
  if (parsed?.classification) {
    parsed.classification.business_line = canonicalEnumValue(parsed.classification.business_line, BUSINESS_LINES);
  }
  for (const item of parsed?.document_types || []) {
    item.document_type = canonicalEnumValue(item.document_type, DOCUMENT_TYPES);
  }
  for (const item of parsed?.missing_documents || []) {
    item.document_type = canonicalEnumValue(item.document_type, DOCUMENT_TYPES);
  }
  for (const field of parsed?.fields || []) {
    field.field = canonicalEnumValue(field.field, CLAIM_FIELDS);
  }

  const sourceGroups = [
    parsed?.classification?.sources,
    ...(parsed?.document_types || []).map((item) => item.sources),
    ...(parsed?.fields || []).map((item) => item.sources),
    ...(parsed?.adjustment_line_items || []).map((item) => item.sources),
    ...(parsed?.evidence_findings || []).map((item) => item.sources),
  ];
  for (const sources of sourceGroups) {
    for (const source of sources || []) {
      source.evidence_mode = canonicalEnumValue(source.evidence_mode, EVIDENCE_MODES);
    }
  }
  return parsed;
}

function anthropicTextCandidates(body) {
  if (!Array.isArray(body?.content)) return [];
  const blocks = body.content
    .filter((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim())
    .map((block) => block.text);
  return blocks.length ? [blocks.join("")] : [];
}

function successfulResponseError(body, status, requestId) {
  const stopReason = body?.stop_reason;
  if (stopReason === "max_tokens") {
    return providerError(status, {
      message: "Claude reached max_tokens before completing the structured analysis.",
      type: "incomplete_structured_output",
    }, requestId);
  }
  if (stopReason === "refusal") {
    return providerError(status, {
      message: "Claude refused the evidence-analysis request instead of returning structured analysis.",
      type: "refusal",
    }, requestId);
  }
  if (stopReason && stopReason !== "end_turn") {
    return providerError(status, {
      message: `Claude stopped with ${stopReason} instead of completing the structured analysis.`,
      type: "incomplete_structured_output",
    }, requestId);
  }
  const blockTypes = Array.isArray(body?.content)
    ? body.content.map((block) => block?.type || "unknown").join(", ") || "none"
    : "invalid content container";
  return providerError(status, {
    message: `Claude returned no non-empty structured text block (content block types: ${blockTypes}; stop_reason: ${stopReason || "missing"}).`,
    type: "missing_structured_output",
  }, requestId);
}

function parseAnthropicStructuredResponse(body, status, requestId) {
  if (body?.type === "error") throw providerError(status, body, requestId);
  const reachedOutputCap = body?.stop_reason === "max_tokens";
  if (["refusal", "pause_turn", "tool_use", "stop_sequence"].includes(body?.stop_reason)) {
    throw successfulResponseError(body, status, requestId);
  }

  const candidates = anthropicTextCandidates(body);
  if (!candidates.length) throw successfulResponseError(body, status, requestId);

  const outputText = candidates[0];
  let decoded;
  try {
    decoded = JSON.parse(outputText);
  } catch (error) {
    throw providerError(status, {
      message: `Claude structured output JSON parse failed: ${error.message}`,
      type: "invalid_structured_json",
    }, requestId);
  }
  const transportValidation = anthropicTransportSchema.safeParse(normalizeAnthropicTransportShape(decoded));
  if (!transportValidation.success) {
    const issues = transportValidation.error.issues.slice(0, 12).map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    });
    throw providerError(status, {
      message: `Claude transport schema validation failed: ${issues.join("; ")}`,
      type: "invalid_transport_schema",
    }, requestId);
  }

  const reconstructed = reconstructCanonicalAnalysis(transportValidation.data);
  const validation = claimAnalysisSchema.safeParse(normalizeAnthropicEnumCasing(reconstructed));
  if (!validation.success) {
    const issues = validation.error.issues.slice(0, 12).map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    });
    throw providerError(status, {
      message: `Claude structured output schema validation failed: ${issues.join("; ")}`,
      type: "invalid_structured_schema",
    }, requestId);
  }
  const parsed = claimAnalysisSchema.parse(completeUnsupportedClaimFields(validation.data));
  return reachedOutputCap
    ? {
        ...parsed,
        warnings: [...parsed.warnings, "Claude reached its output cap after returning a complete structured payload; review the cited issue ledger before final issue."],
        human_review_required: [...parsed.human_review_required, "Confirm the cited issue ledger is complete before final issue because Claude reached its output cap."],
      }
    : parsed;
}

function contentBlocks(claim, evidence, files, styleReferences) {
  const content = [{
    type: "text",
    text: promptText(claim, evidence, styleReferences),
    cache_control: { type: "ephemeral" },
  }];
  const sentImageHashes = new Set();
  const includeImage = (buffer) => {
    const fingerprint = crypto.createHash("sha256").update(buffer).digest("hex");
    if (sentImageHashes.has(fingerprint)) return false;
    sentImageHashes.add(fingerprint);
    return true;
  };
  evidence.forEach((item, index) => {
    const file = files[index];
    if (!file) return;
    if (item.kind === "pdf" && item.native_pdf) {
      content.push({ type: "text", text: `[Native PDF evidence: ${item.document_name}]` });
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
      });
    }
    if (item.kind === "image" && includeImage(file.buffer)) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: item.mime_type, data: file.buffer.toString("base64") },
      });
    }
    (item.vision_images || []).forEach((pageImage) => {
      if (!includeImage(pageImage.buffer)) return;
      content.push({ type: "text", text: `[Visual evidence: ${item.document_name}, page ${pageImage.page}]` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: pageImage.mime_type, data: pageImage.buffer.toString("base64") },
      });
    });
    (item.embedded_images || []).forEach((embedded) => {
      if (!includeImage(embedded.buffer)) return;
      content.push({ type: "text", text: `[Embedded visual evidence: ${item.document_name}, ${embedded.name || "image"}]` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: embedded.mime_type, data: embedded.buffer.toString("base64") },
      });
    });
  });
  content.push({
    type: "text",
    text: `<final_task>Apply the Claude loss-adjuster decision workflow to all evidence above. Use the bounded thinking budget efficiently for the multi-step investigation and senior-review audit, then reserve the remaining output budget for one complete structured payload. Return only material, evidence-supported non-null fields; missing fields are completed locally. Preserve every material conflict without duplicating facts, narrative, or citations. Use finding records for the completed professional issue analysis, not an observation dump. Before encoding the structured payload, verify that chronology/custody, condition/extent, competing cause hypotheses, policy application, quantum/mitigation, liability/recovery, and decision-specific evidence gaps have each been addressed where relevant. Return only the required structured payload; do not reveal private reasoning or intermediate notes.</final_task>`,
  });
  return content;
}

function buildAnthropicRequestBody({ model, maxOutputTokens, claim, evidence, files, styleReferences = [] }) {
  const thinking = /claude-(?:sonnet|opus)-(?:4-6|5)|claude-3-7-sonnet/i.test(model) && maxOutputTokens >= 4_096
    ? {
      type: "enabled",
      budget_tokens: Math.min(SONNET_4_6_THINKING_BUDGET_TOKENS, Math.floor(maxOutputTokens / 4)),
    }
    : { type: "adaptive" };
  return {
    model,
    max_tokens: maxOutputTokens,
    stream: true,
    thinking,
    output_config: {
      format: {
        type: "json_schema",
        schema: structuredOutputSchema(),
      },
    },
    system: ANTHROPIC_SYSTEM_INSTRUCTIONS,
    messages: [{ role: "user", content: contentBlocks(claim, evidence, files, styleReferences) }],
  };
}

export function createAnthropicProvider({
  apiKey,
  model,
  maxOutputTokens,
  fetchImpl = globalThis.fetch,
  endpoint = ANTHROPIC_MESSAGES_URL,
  verifiedClassificationRecovery = true,
} = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const resolvedMaxOutputTokens = resolveMaxOutputTokens(maxOutputTokens, resolvedModel);
  return {
    name: "anthropic",
    model: resolvedModel,
    async analyze({ claim, evidence, files, styleReferences = [] }) {
      const prepared = prepareEvidenceForAnthropic(evidence);
      const claimContext = prepareClaimContextForAnthropic(claim);
      const requestBody = buildAnthropicRequestBody({
        model: resolvedModel,
        maxOutputTokens: resolvedMaxOutputTokens,
        claim: claimContext,
        evidence: prepared.evidence,
        files,
        styleReferences,
      });
      const requestBodyText = JSON.stringify(requestBody);
      const requestBytes = Buffer.byteLength(requestBodyText);
      const requestStartedAt = Date.now();
      const transportContext = {
        provider: "anthropic",
        model: resolvedModel,
        stream: true,
        max_output_tokens: resolvedMaxOutputTokens,
        request_bytes: requestBytes,
      };
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": apiKey,
          },
          body: requestBodyText,
        });
      } catch (error) {
        throw logTransportFailure(error, {
          ...transportContext,
          phase: "awaiting_response_headers",
          elapsed_ms: Date.now() - requestStartedAt,
          http_status: null,
          provider_request_id: null,
        });
      }
      const requestId = response.headers?.get?.("request-id") || response.headers?.get?.("x-request-id") || null;
      const responseHeadersElapsedMs = Date.now() - requestStartedAt;
      safeAiDebugLog("[ULA AI debug] Claude response headers", {
        http_status: response.status,
        model: resolvedModel,
        provider_request_id: requestId,
        elapsed_ms: responseHeadersElapsedMs,
      });
      let responseText;
      try {
        responseText = await response.text();
      } catch (error) {
        throw logTransportFailure(error, {
          ...transportContext,
          phase: "reading_response_stream",
          elapsed_ms: Date.now() - requestStartedAt,
          response_headers_elapsed_ms: responseHeadersElapsedMs,
          http_status: response.status,
          provider_request_id: requestId,
        });
      }
      let body;
      try {
        body = parseAnthropicResponseBody(
          responseText,
          response.headers?.get?.("content-type") || "",
        );
      } catch (error) {
        throw providerError(response.status, {
          message: `Claude returned an unreadable response body: ${error.message}`,
          type: "invalid_response_body",
        }, requestId);
      }
      safeAiDebugLog("[ULA AI debug] Claude response metadata", {
        http_status: response.status,
        model: body.model || resolvedModel,
        response_id: body.id || requestId,
        stop_reason: body.stop_reason || null,
        output_tokens: body.usage?.output_tokens ?? null,
        max_output_tokens: resolvedMaxOutputTokens,
        elapsed_ms: Date.now() - requestStartedAt,
      });
      if (!response.ok) throw providerError(response.status, body, requestId);
      const parsed = parseAnthropicStructuredResponse(body, response.status, requestId);
      const usage = calculateAnthropicUsage({
        model: body.model || resolvedModel,
        usage: body.usage,
      });
      return {
        provider: "anthropic",
        model: body.model || resolvedModel,
        response_id: body.id || requestId,
        provider_api_status: response.status,
        analyzed_at: new Date().toISOString(),
        usage,
        analysis: enforceAnalysisCoverage(
          enforceAnthropicGrounding(
            sanitizeReferenceNarrative(parsed, styleReferences),
            evidence,
            { verifiedClassificationRecovery },
          ),
          evidence,
        ),
      };
    },
  };
}

export function calculateAnthropicUsage({ model, usage } = {}) {
  return calculateAiUsage({
    provider: "anthropic",
    model,
    rawUsage: usage,
  });
}

export const anthropicProviderInternals = {
  calculateAnthropicUsage,
  anthropicTransportSchema,
  completeUnsupportedClaimFields,
  defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  jsonContract: ANTHROPIC_JSON_CONTRACT,
  lossAdjusterReasoningProtocol: ANTHROPIC_LOSS_ADJUSTER_REASONING_PROTOCOL,
  maxSonnet46OutputTokens: MAX_SONNET_4_6_OUTPUT_TOKENS,
  measureJsonSchemaComplexity,
  resolveMaxOutputTokens,
  systemInstructions: ANTHROPIC_SYSTEM_INSTRUCTIONS,
  contentBlocks,
  deterministicBusinessLine,
  deterministicPolicyNumber,
  enforceAnthropicGrounding,
  anthropicTextCandidates,
  buildRequestBody: buildAnthropicRequestBody,
  evidenceWindows,
  normalizeAnthropicEnumCasing,
  networkError,
  parseAnthropicEventStream,
  parseAnthropicResponseBody,
  parseAnthropicStructuredResponse,
  providerError,
  reconstructCanonicalAnalysis,
  repairedExtractedTextSource,
  transportErrorMetadata,
  successfulResponseError,
  structuredOutputSchema,
  verifiedSource,
};
