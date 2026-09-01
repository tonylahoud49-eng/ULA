import crypto from "node:crypto";
import {
  BUSINESS_LINES,
  CLAIM_FIELDS,
  DOCUMENT_TYPES,
  EVIDENCE_MODES,
  claimAnalysisSchema,
} from "../claimAnalysisSchema.mjs";
import { safeAiDebugLog, safeAiDiagnosticLog } from "../debugLog.mjs";
import { SYSTEM_INSTRUCTIONS, promptText } from "./openaiProvider.mjs";
import {
  prepareClaimContextForAnthropic,
  prepareEvidenceForAnthropic,
} from "../../evidence/prepareAnthropicEvidence.mjs";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
const MAX_SONNET_4_6_OUTPUT_TOKENS = 128_000;
const ANTHROPIC_JSON_CONTRACT = `The response is constrained by Anthropic JSON structured output. Return only the structured payload: no Markdown fences, preface, trailing commentary, or extra keys.
All confidence values must be between 0 and 1. Use only these exact values:
business_line=${JSON.stringify(BUSINESS_LINES)}
document_type=${JSON.stringify(DOCUMENT_TYPES)}
field=${JSON.stringify(CLAIM_FIELDS)}
evidence_mode=${JSON.stringify(EVIDENCE_MODES)}
Include every top-level key. In fields, return only evidence-supported non-null fields; the application adds unsupported fields locally as null. Never omit a material claim finding, conflict, causation issue, coverage issue, liability issue, quantum item, salvage issue, or recovery issue.
Be concise without losing evidence: do not repeat the same fact across sections; keep summary to at most 4 short sentences; keep each rationale, basis, warning, review item, and finding to one short sentence; include the strongest non-duplicate sources needed to support each item and both sides of every conflict; keep each supporting_text excerpt exact and normally at most 240 characters, using more only when needed to preserve meaning. Return only detected substantive document_types and only required missing_documents.`;
const ANTHROPIC_SYSTEM_INSTRUCTIONS = `${SYSTEM_INSTRUCTIONS}

Cost and calculation boundary:
- Use Claude for document understanding, classification, conflict identification, and causal reasoning.
- Extract source-stated quantities, rates, totals, deductions, and valuation terms, but do not reconstruct or calculate claim totals.
- The deterministic application layer performs arithmetic, reconciliation, validation, and final adjustment calculations.

${ANTHROPIC_JSON_CONTRACT}`;

const REQUIRED_DOCUMENTS = {
  Yacht: ["Policy", "Claim Form", "Supporting Evidence", "Registration", "Repair Invoice or Quotation", "Survey Report", "Photographs"],
  Property: ["Policy", "Claim Form", "Supporting Evidence", "Incident Report", "Repair Invoice or Quotation", "Photographs", "Survey Report"],
  "Marine Cargo (Reefer/GFS)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Report"],
  "Marine Cargo (Non-Reefer)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Notice of Claim", "Survey Report"],
  "Bulk Vessel": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Cargo Certificate", "Survey Report"],
  "Air Shipment (NET)": ["Policy", "Claim Form", "Supporting Evidence", "Air Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
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
const nullable = (type) => ({ type: [type, "null"] });
const sourceOutputSchema = () => closedObject({
  document_id: { type: "string" },
  document_name: { type: "string" },
  page: nullable("integer"),
  supporting_text: { type: "string" },
  confidence: { type: "number" },
  evidence_mode: { type: "string" },
});

// This deliberately constrains structure and primitive types only. The full
// enums, numeric bounds, and evidence rules remain enforced by the canonical
// Zod schema after parsing. Omitting large enums keeps Anthropic's compiled
// grammar below its complexity ceiling without weakening local validation.
function structuredOutputSchema() {
  const sources = () => arrayOf(sourceOutputSchema());
  return closedObject({
    classification: closedObject({
      business_line: { type: "string" },
      confidence: { type: "number" },
      rationale: { type: "string" },
      sources: sources(),
    }),
    document_types: arrayOf(closedObject({
      document_type: { type: "string" },
      confidence: { type: "number" },
      sufficient_information: { type: "boolean" },
      rationale: { type: "string" },
      sources: sources(),
    })),
    fields: arrayOf(closedObject({
      field: { type: "string" },
      value: nullable("string"),
      normalized_value: nullable("string"),
      confidence: { type: "number" },
      requires_confirmation: { type: "boolean" },
      sources: sources(),
    })),
    adjustment_line_items: arrayOf(closedObject({
      description: { type: "string" },
      quantity: nullable("string"),
      unit_price: nullable("string"),
      adjusted_value: { type: "string" },
      currency: nullable("string"),
      basis: { type: "string" },
      confidence: { type: "number" },
      sources: sources(),
    })),
    missing_documents: arrayOf(closedObject({
      document_type: { type: "string" },
      reason: { type: "string" },
      missing_information: arrayOf({ type: "string" }),
    })),
    evidence_findings: arrayOf(closedObject({
      finding: { type: "string" },
      confidence: { type: "number" },
      sources: sources(),
    })),
    summary: { type: "string" },
    warnings: arrayOf({ type: "string" }),
    human_review_required: arrayOf({ type: "string" }),
  });
}

function resolveMaxOutputTokens(value, model = DEFAULT_MODEL) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_024) {
    throw new RangeError("ANTHROPIC_MAX_OUTPUT_TOKENS must be an integer of at least 1024.");
  }
  const maximum = model === "claude-sonnet-4-6"
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

function enforceAnthropicGrounding(parsed, evidence) {
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

  const directClassificationSources = verifySources(parsed.classification.sources);
  const corroboratingDocumentTypes = documentTypes.filter((item) => item.sufficient_information && item.sources.length);
  const corroboratingSources = [...new Map(corroboratingDocumentTypes
    .flatMap((item) => item.sources)
    .map((source) => [`${source.document_id}:${source.supporting_text}`, source])).values()];
  const canUseCorroboratingSources = parsed.classification.business_line !== "Other / Requires Review"
    && new Set(corroboratingDocumentTypes.map((item) => item.document_type)).size >= 2;
  const classificationSources = directClassificationSources.length
    ? directClassificationSources
    : canUseCorroboratingSources ? corroboratingSources.slice(0, 4) : [];
  const classification = classificationSources.length
    ? { ...parsed.classification, sources: classificationSources }
    : {
        business_line: "Other / Requires Review",
        confidence: 0,
        rationale: "Claude did not return a verifiable evidence source for the classification.",
        sources: [],
      };
  if (!directClassificationSources.length && canUseCorroboratingSources) {
    warnings.push("Claude's classification citation was repaired using its verified document-type citations.");
  } else if (!classificationSources.length) {
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

const canonicalEnumValue = (value, allowed) => {
  if (typeof value !== "string") return value;
  return allowed.find((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) || value;
};

function normalizeAnthropicEnumCasing(value) {
  const parsed = structuredClone(value || {});
  if (!parsed.classification) {
    parsed.classification = { business_line: "Other / Requires Review", confidence: 0.8, rationale: "", sources: [] };
  } else {
    parsed.classification.business_line = canonicalEnumValue(parsed.classification.business_line, BUSINESS_LINES);
    parsed.classification.confidence = parsed.classification.confidence ?? 0.9;
    parsed.classification.rationale = parsed.classification.rationale ?? "";
    parsed.classification.sources = parsed.classification.sources ?? [];
  }

  if (Array.isArray(parsed.document_types)) {
    parsed.document_types = parsed.document_types.map((item) => ({
      document_type: canonicalEnumValue(item.document_type || "Supporting Evidence", DOCUMENT_TYPES),
      confidence: item.confidence ?? 0.95,
      sufficient_information: item.sufficient_information ?? true,
      rationale: item.rationale ?? "",
      sources: item.sources ?? [],
    }));
  }

  if (Array.isArray(parsed.missing_documents)) {
    parsed.missing_documents = parsed.missing_documents.map((item) => ({
      document_type: canonicalEnumValue(item.document_type || "Policy", DOCUMENT_TYPES),
      reason: typeof item.reason === "string" ? item.reason : (item.reason?.reason || item.reason?.message || "Missing document"),
      missing_information: (item.missing_information || []).map((m) => typeof m === "string" ? m : (m?.item || m?.field || m?.name || JSON.stringify(m))),
    }));
  }

  if (Array.isArray(parsed.fields)) {
    parsed.fields = parsed.fields.map((field) => ({
      field: canonicalEnumValue(field.field || "loss_description", CLAIM_FIELDS),
      value: field.value ?? null,
      normalized_value: field.normalized_value ?? field.value ?? null,
      confidence: field.confidence ?? 0.9,
      requires_confirmation: field.requires_confirmation ?? false,
      sources: field.sources ?? [],
    }));
  }

  if (Array.isArray(parsed.adjustment_line_items)) {
    parsed.adjustment_line_items = parsed.adjustment_line_items.map((item) => ({
      description: item.description || "Adjustment",
      quantity: item.quantity ?? null,
      unit_price: item.unit_price ?? null,
      adjusted_value: String(item.adjusted_value ?? "0.00"),
      currency: item.currency ?? "USD",
      basis: item.basis ?? "",
      confidence: item.confidence ?? 0.95,
      sources: item.sources ?? [],
    }));
  }

  if (Array.isArray(parsed.evidence_findings)) {
    parsed.evidence_findings = parsed.evidence_findings.map((item) => ({
      finding: typeof item.finding === "string" ? item.finding : (item?.finding?.finding || item?.finding?.text || item?.description || JSON.stringify(item)),
      confidence: item.confidence ?? 0.9,
      sources: item.sources ?? [],
    }));
  }

  if (parsed.summary !== undefined) {
    parsed.summary = typeof parsed.summary === "string" ? parsed.summary : (parsed.summary?.summary || parsed.summary?.text || JSON.stringify(parsed.summary || ""));
  }
  if (Array.isArray(parsed.warnings)) {
    parsed.warnings = parsed.warnings.map((w) =>
      typeof w === "string" ? w : (w?.warning || w?.message || w?.text || w?.description || JSON.stringify(w))
    );
  }
  if (Array.isArray(parsed.human_review_required)) {
    parsed.human_review_required = parsed.human_review_required.map((h) =>
      typeof h === "string" ? h : (h?.item || h?.reason || h?.action || h?.description || h?.message || h?.text || JSON.stringify(h))
    );
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
      source.evidence_mode = canonicalEnumValue(source.evidence_mode || "extracted_text", EVIDENCE_MODES);
      source.confidence = source.confidence ?? 0.9;
      source.supporting_text = source.supporting_text || "";
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
  if (["max_tokens", "refusal", "pause_turn", "tool_use", "stop_sequence"].includes(body?.stop_reason)) {
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
  const validation = claimAnalysisSchema.safeParse(normalizeAnthropicEnumCasing(decoded));
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
  return completeUnsupportedClaimFields(validation.data);
}

function contentBlocks(claim, evidence, files, styleReferences) {
  const content = [{
    type: "text",
    text: `${promptText(claim, evidence, styleReferences)}\n\nReturn only evidence-supported non-null fields; missing fields are completed locally. Preserve every material distinct finding and conflict, but do not duplicate narrative or citations.`,
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
  return content;
}

function buildAnthropicRequestBody({ model, maxOutputTokens, claim, evidence, files, styleReferences = [] }) {
  return {
    model,
    max_tokens: maxOutputTokens,
    stream: true,
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
      return {
        provider: "anthropic",
        model: body.model || resolvedModel,
        response_id: body.id || requestId,
        provider_api_status: response.status,
        analyzed_at: new Date().toISOString(),
        analysis: enforceAnthropicGrounding(parsed, evidence),
      };
    },
  };
}

export const anthropicProviderInternals = {
  completeUnsupportedClaimFields,
  defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  jsonContract: ANTHROPIC_JSON_CONTRACT,
  maxSonnet46OutputTokens: MAX_SONNET_4_6_OUTPUT_TOKENS,
  resolveMaxOutputTokens,
  systemInstructions: ANTHROPIC_SYSTEM_INSTRUCTIONS,
  contentBlocks,
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
  repairedExtractedTextSource,
  transportErrorMetadata,
  successfulResponseError,
  structuredOutputSchema,
  verifiedSource,
};
