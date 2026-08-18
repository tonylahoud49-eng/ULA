import { zodResponseFormat } from "openai/helpers/zod";
import {
  BUSINESS_LINES,
  CLAIM_FIELDS,
  DOCUMENT_TYPES,
  EVIDENCE_MODES,
  claimAnalysisSchema,
} from "../claimAnalysisSchema.mjs";
import { safeAiDebugLog } from "../debugLog.mjs";
import { SYSTEM_INSTRUCTIONS, promptText } from "./openaiProvider.mjs";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 16_384;

// Claude structured outputs intentionally support only a subset of JSON Schema.
// Keep the complete Zod schema for validating Claude's response below, while
// removing constraints that Anthropic's grammar compiler does not accept.
const ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$schema",
]);

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

function structuredOutputSchema() {
  const schema = structuredClone(zodResponseFormat(claimAnalysisSchema, "ula_claim_analysis").json_schema.schema);
  const makeAnthropicCompatible = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) {
      if (value.nullable === true) {
        if (typeof value.type === "string") value.type = [value.type, "null"];
        else if (Array.isArray(value.type) && !value.type.includes("null")) value.type.push("null");
        delete value.nullable;
      }
      for (const keyword of ANTHROPIC_UNSUPPORTED_SCHEMA_KEYWORDS) delete value[keyword];
    }
    Object.values(value).forEach(makeAnthropicCompatible);
  };
  makeAnthropicCompatible(schema);

  // openai's Zod helper emits an unreferenced duplicate of the complete root
  // schema. Sending it makes Anthropic compile the same grammar twice and can
  // exceed Claude's structured-output complexity limit.
  const referencedDefinitions = new Set();
  const findDefinitionReferences = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/definitions/")) {
      referencedDefinitions.add(value.$ref.slice("#/definitions/".length));
    }
    Object.entries(value).forEach(([key, child]) => {
      if (key !== "definitions") findDefinitionReferences(child);
    });
  };
  findDefinitionReferences(schema);
  for (const name of referencedDefinitions) findDefinitionReferences(schema.definitions?.[name]);
  for (const name of Object.keys(schema.definitions || {})) {
    if (!referencedDefinitions.has(name)) delete schema.definitions[name];
  }
  return schema;
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

const canonicalEnumValue = (value, allowed) => {
  if (typeof value !== "string") return value;
  return allowed.find((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) || value;
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
  if (blocks.length < 2) return blocks;
  const combined = blocks.join("");
  return [combined, ...blocks.filter((block) => block !== combined)];
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

  let lastError;
  for (const outputText of candidates) {
    try {
      return claimAnalysisSchema.parse(normalizeAnthropicEnumCasing(JSON.parse(outputText)));
    } catch (error) {
      lastError = error;
    }
  }
  throw providerError(status, {
    message: `Claude returned invalid structured analysis: ${lastError?.message || "The response was not valid JSON."}`,
    type: "invalid_structured_output",
  }, requestId);
}

function contentBlocks(claim, evidence, files, styleReferences) {
  const content = [{
    type: "text",
    text: `${promptText(claim, evidence, styleReferences)}\n\nReturn one fields entry for every supported claim field. Use null for every fact not supported by uploaded evidence. Keep source excerpts short and exact.`,
  }];
  evidence.forEach((item, index) => {
    const file = files[index];
    if (!file) return;
    if (item.kind === "pdf") {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
        title: item.document_name,
      });
    } else if (item.kind === "image") {
      content.push({
        type: "image",
        source: { type: "base64", media_type: item.mime_type, data: file.buffer.toString("base64") },
      });
    }
    (item.embedded_images || []).forEach((embedded) => content.push({
      type: "image",
      source: { type: "base64", media_type: embedded.mime_type, data: embedded.buffer.toString("base64") },
    }));
  });
  return content;
}

export function createAnthropicProvider({ apiKey, model, fetchImpl = globalThis.fetch, endpoint = ANTHROPIC_MESSAGES_URL } = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  return {
    name: "anthropic",
    model: resolvedModel,
    async analyze({ claim, evidence, files, styleReferences = [] }) {
      const requestBody = {
        model: resolvedModel,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: SYSTEM_INSTRUCTIONS,
        messages: [{ role: "user", content: contentBlocks(claim, evidence, files, styleReferences) }],
        output_config: { format: { type: "json_schema", schema: structuredOutputSchema() } },
      };
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
      });
      const requestId = response.headers?.get?.("request-id") || response.headers?.get?.("x-request-id") || null;
      const responseText = await response.text();
      let body;
      try {
        body = responseText ? JSON.parse(responseText) : {};
      } catch (error) {
        throw providerError(response.status, {
          message: `Claude returned an unreadable response body: ${error.message}`,
          type: "invalid_response_body",
        }, requestId);
      }
      safeAiDebugLog("[ULA AI debug] Claude raw response", body);
      if (!response.ok) throw providerError(response.status, body, requestId);
      const parsed = parseAnthropicStructuredResponse(body, response.status, requestId);
      safeAiDebugLog("[ULA AI debug] Claude structured result", {
        model: body.model || resolvedModel,
        response_id: body.id || requestId,
        result: parsed,
      });
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
  contentBlocks,
  enforceAnthropicGrounding,
  anthropicTextCandidates,
  evidenceWindows,
  normalizeAnthropicEnumCasing,
  parseAnthropicStructuredResponse,
  providerError,
  repairedExtractedTextSource,
  successfulResponseError,
  structuredOutputSchema,
  verifiedSource,
};
