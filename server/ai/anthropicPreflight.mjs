import crypto from "node:crypto";
import { safeAiDebugLog } from "./debugLog.mjs";
import { anthropicProviderInternals } from "./providers/anthropicProvider.mjs";
import { extractEvidenceFile, evidenceText } from "../evidence/extractEvidence.mjs";
import { selectLegalReferences } from "./referenceLayer.mjs";
import {
  prepareClaimContextForAnthropic,
  prepareEvidenceForAnthropic,
} from "../evidence/prepareAnthropicEvidence.mjs";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
// The direct Messages API limit is 32 MB. Keep local headroom for encoding and
// provider-side request framing so an oversized request is stopped before fetch.
const DEFAULT_MAX_REQUEST_BYTES = 30 * 1024 * 1024;
const DEFAULT_MAX_ESTIMATED_INPUT_TOKENS = 180_000;
const DEFAULT_CONNECTIVITY_TIMEOUT_MS = 15_000;
const PREFLIGHT_TTL_MS = 5 * 60 * 1000;
const preflightTokens = new Map();

export class AnthropicPreflightError extends Error {
  constructor(message, { status = 400, code = "anthropic-preflight-failed", providerStatus = null, providerRequestId = null, stats = null } = {}) {
    super(message);
    this.name = "AnthropicPreflightError";
    this.status = status;
    this.code = code;
    this.providerStatus = providerStatus;
    this.providerRequestId = providerRequestId;
    this.stats = stats;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function anthropicSafetyLimits(env = process.env) {
  return {
    max_files: positiveInteger(env.AI_MAX_FILES, 20),
    max_file_bytes: positiveInteger(env.AI_MAX_FILE_BYTES, 30 * 1024 * 1024),
    max_total_upload_bytes: positiveInteger(env.AI_MAX_TOTAL_BYTES, 50 * 1024 * 1024),
    max_request_bytes: positiveInteger(env.ANTHROPIC_MAX_REQUEST_BYTES, DEFAULT_MAX_REQUEST_BYTES),
    max_estimated_input_tokens: positiveInteger(
      env.ANTHROPIC_MAX_ESTIMATED_INPUT_TOKENS,
      DEFAULT_MAX_ESTIMATED_INPUT_TOKENS,
    ),
  };
}

export function validateAnthropicConfiguration(env = process.env) {
  const provider = String(env.AI_PROVIDER || "").trim().toLowerCase();
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const model = String(env.ANTHROPIC_MODEL || "").trim();
  if (provider !== "anthropic") {
    throw new AnthropicPreflightError("AI_PROVIDER must be set to anthropic before Claude analysis.", {
      code: "anthropic-provider-not-selected",
    });
  }
  if (!apiKey) {
    throw new AnthropicPreflightError("ANTHROPIC_API_KEY is missing from the server environment.", {
      code: "anthropic-api-key-missing",
    });
  }
  if (!model) {
    throw new AnthropicPreflightError("ANTHROPIC_MODEL is missing from the server environment.", {
      code: "anthropic-model-missing",
    });
  }
  let maxOutputTokens;
  try {
    maxOutputTokens = anthropicProviderInternals.resolveMaxOutputTokens(
      env.ANTHROPIC_MAX_OUTPUT_TOKENS,
      model,
    );
  } catch (error) {
    throw new AnthropicPreflightError(error.message, {
      code: "anthropic-output-token-limit-invalid",
    });
  }
  return { provider, apiKey, model, maxOutputTokens };
}

function safePreflightLog(payload) {
  try {
    console.info("[ULA Anthropic preflight]", payload);
  } catch {
    // A closed development output stream must never affect provider readiness.
  }
}

function providerMessage(body, status) {
  return body?.error?.message || body?.message || `Anthropic connectivity test failed with HTTP ${status}.`;
}

export async function testAnthropicConnectivity({
  env = process.env,
  fetchImpl = globalThis.fetch,
  endpoint = ANTHROPIC_MESSAGES_URL,
} = {}) {
  const { apiKey, model } = validateAnthropicConfiguration(env);
  const timeoutMs = positiveInteger(env.ANTHROPIC_CONNECTIVITY_TIMEOUT_MS, DEFAULT_CONNECTIVITY_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        temperature: 0,
        messages: [{ role: "user", content: "Reply OK." }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    safePreflightLog({ http_status: "network_error", model });
    throw new AnthropicPreflightError(`Anthropic connectivity test failed: ${error.message}`, {
      status: 502,
      code: "anthropic-connectivity-network-error",
    });
  }

  const requestId = response.headers?.get?.("request-id") || response.headers?.get?.("x-request-id") || null;
  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = {};
  }
  const responseModel = body.model || model;
  safePreflightLog({ http_status: response.status, model: responseModel });
  if (!response.ok || body.type === "error") {
    throw new AnthropicPreflightError(providerMessage(body, response.status), {
      status: 502,
      code: "anthropic-connectivity-rejected",
      providerStatus: response.status,
      providerRequestId: requestId,
    });
  }
  return {
    ok: true,
    provider: "anthropic",
    model: responseModel,
    http_status: response.status,
    response_id: body.id || requestId,
  };
}

function fullRequestBody(model, maxOutputTokens, claim, evidence, files, styleReferences) {
  return anthropicProviderInternals.buildRequestBody({
    model,
    maxOutputTokens,
    claim,
    evidence,
    files,
    styleReferences,
  });
}

function estimateInputTokens(requestBody, evidence) {
  const textCharacters = requestBody.system.length
    + JSON.stringify(requestBody.output_config).length
    + requestBody.messages[0].content
      .filter((block) => block.type === "text")
      .reduce((total, block) => total + String(block.text || "").length, 0);
  const images = evidence.reduce((total, item) => total
    + (item.kind === "image" ? 1 : 0)
    + (item.vision_images?.length || 0)
    + (item.embedded_images?.length || 0)
    + (item.native_pdf ? (item.pages?.length || 1) : 0), 0);
  return Math.ceil(textCharacters / 4) + (images * 2_000);
}

function modelContextTokens(model) {
  return /claude-sonnet-4-6/i.test(String(model || "")) ? 1_000_000 : 200_000;
}

export async function validateAnthropicClaimLocally({
  claim,
  manifest,
  files,
  styleReferences = [],
  legalReferenceIndexPath,
  env = process.env,
} = {}) {
  const { model, maxOutputTokens } = validateAnthropicConfiguration(env);
  const limits = anthropicSafetyLimits(env);
  if (!claim?.id) {
    throw new AnthropicPreflightError("A valid claim payload is required.", { code: "preflight-invalid-claim" });
  }
  if (!Array.isArray(manifest) || !manifest.length || !Array.isArray(files) || !files.length) {
    throw new AnthropicPreflightError("The analysis request payload is empty.", { code: "preflight-empty-payload" });
  }
  if (files.length !== manifest.length) {
    throw new AnthropicPreflightError("Every registered evidence item must include an accessible uploaded file.", {
      code: "preflight-incomplete-evidence-set",
    });
  }
  if (files.length > limits.max_files) {
    throw new AnthropicPreflightError(`The claim has ${files.length} files; the configured limit is ${limits.max_files}.`, {
      status: 413,
      code: "preflight-file-count-limit",
    });
  }
  for (const file of files) {
    if (!file?.buffer?.length || !Number(file.size)) {
      throw new AnthropicPreflightError(`${file?.originalname || "An uploaded file"} is not accessible or is empty.`, {
        code: "preflight-file-unavailable",
      });
    }
    if (file.size > limits.max_file_bytes) {
      throw new AnthropicPreflightError(`${file.originalname} exceeds the configured per-file safety limit.`, {
        status: 413,
        code: "preflight-file-size-limit",
      });
    }
  }
  const uploadedBytes = files.reduce((total, file) => total + file.size, 0);
  if (uploadedBytes > limits.max_total_upload_bytes) {
    throw new AnthropicPreflightError("The complete evidence set exceeds the configured upload safety limit.", {
      status: 413,
      code: "preflight-upload-size-limit",
    });
  }

  let evidence;
  try {
    evidence = await Promise.all(files.map((file, index) => extractEvidenceFile(file, { ...manifest[index], index })));
  } catch (error) {
    throw new AnthropicPreflightError(`A required document-processing dependency failed: ${error.message}`, {
      status: 500,
      code: "preflight-dependency-failed",
    });
  }
  const extractedTextCharacters = evidence.reduce((total, item) => total + evidenceText(item).length, 0);
  if (!extractedTextCharacters && !evidence.some((item) => item.native_pdf)) {
    throw new AnthropicPreflightError("No extracted document text is available for analysis.", {
      code: "preflight-no-extracted-text",
    });
  }
  if (evidence.some((item) => item.extraction_status === "failed")) {
    const failed = evidence.find((item) => item.extraction_status === "failed");
    throw new AnthropicPreflightError(failed.warning || "At least one required document could not be extracted.", {
      status: failed.error_status || 500,
      code: failed.error_code || "preflight-extraction-failed",
    });
  }
  const incompletePdf = evidence.find((item) => item.kind === "pdf" && (!Array.isArray(item.pages)
    || !item.pages.length
    || item.pages.some((page, index) => page.page !== index + 1)));
  if (incompletePdf) {
    throw new AnthropicPreflightError(`${incompletePdf.document_name} does not have complete sequential page coverage for analysis.`, {
      code: "preflight-incomplete-page-coverage",
    });
  }

  const prepared = prepareEvidenceForAnthropic(evidence);
  const claimContext = prepareClaimContextForAnthropic(claim);
  const legalReferences = legalReferenceIndexPath
    ? await selectLegalReferences({ claim: claimContext, evidence: prepared.evidence, indexPath: legalReferenceIndexPath })
    : [];
  const analysisReferences = [...styleReferences, ...legalReferences];
  const requestBody = fullRequestBody(
    model,
    maxOutputTokens,
    claimContext,
    prepared.evidence,
    files,
    analysisReferences,
  );
  const requestBytes = Buffer.byteLength(JSON.stringify(requestBody));
  const estimatedInputTokens = estimateInputTokens(requestBody, prepared.evidence);
  const contextTokens = modelContextTokens(model);
  const estimatedContextTokens = estimatedInputTokens + maxOutputTokens;
  const sentTextCharacters = prepared.evidence.reduce((total, item) => total + evidenceText(item).length, 0);
  const sentVisuals = prepared.evidence.reduce((total, item) => total
    + (item.kind === "image" ? 1 : 0)
    + (item.vision_images?.length || 0)
    + (item.embedded_images?.length || 0), 0);
  const stats = {
    document_count: files.length,
    uploaded_bytes: uploadedBytes,
    extracted_text_characters: extractedTextCharacters,
    extracted_text_bytes: Buffer.byteLength(evidence.map((item) => evidenceText(item)).join("\n")),
    sent_text_characters: sentTextCharacters,
    sent_visual_count: sentVisuals,
    native_pdf_count: prepared.evidence.filter((item) => item.native_pdf).length,
    raw_pdf_files_sent: 0,
    estimated_request_bytes: requestBytes,
    estimated_input_tokens: estimatedInputTokens,
    estimated_cost_usd: Number((estimatedInputTokens / 1_000_000 * 3.00).toFixed(4)),
    selected_provider: "anthropic",
    selected_model: model,
    max_output_tokens: maxOutputTokens,
    model_context_tokens: contextTokens,
    estimated_input_plus_max_output_tokens: estimatedContextTokens,
    estimated_context_headroom_tokens: contextTokens - estimatedContextTokens,
    claim_context_fields: Object.keys(claimContext),
    system_instruction_characters: requestBody.system.length,
    json_contract_characters: anthropicProviderInternals.jsonContract.length,
    json_schema_characters: JSON.stringify(requestBody.output_config.format.schema).length,
    json_schema_complexity: anthropicProviderInternals.measureJsonSchemaComplexity(
      requestBody.output_config.format.schema,
    ),
    legal_reference_count: legalReferences.length,
    legal_reference_characters: legalReferences.reduce((total, item) => total + item.excerpt.length, 0),
    legal_reference_sources: [...new Set(legalReferences.map((item) => item.title))],
    limits,
    local_reduction: prepared.stats,
    payload_summary: prepared.evidence.map((item) => ({
      document_id: item.document_id,
      document_name: item.document_name,
      extracted_text_characters: evidenceText(item).length,
      included_text_pages: (item.pages || []).filter((page) => page.text).map((page) => page.page),
      included_vision_pages: (item.vision_images || []).map((image) => image.page),
      embedded_visuals: item.embedded_images?.length || 0,
      raw_file_sent: item.kind === "image",
    })),
  };
  if (requestBytes > limits.max_request_bytes) {
    throw new AnthropicPreflightError(
      `Estimated Anthropic request size ${requestBytes} bytes exceeds the configured limit of ${limits.max_request_bytes} bytes.`,
      { status: 413, code: "preflight-request-size-limit", stats },
    );
  }
  if (estimatedInputTokens > limits.max_estimated_input_tokens) {
    throw new AnthropicPreflightError(
      `Estimated Claude input ${estimatedInputTokens} tokens exceeds the configured limit of ${limits.max_estimated_input_tokens}.`,
      { status: 413, code: "preflight-token-limit", stats },
    );
  }
  if (estimatedContextTokens > contextTokens) {
    throw new AnthropicPreflightError(
      `Estimated Claude input plus configured output allowance (${estimatedContextTokens} tokens) exceeds the ${contextTokens}-token model context window.`,
      { status: 413, code: "preflight-model-context-limit", stats },
    );
  }
  safeAiDebugLog("[ULA AI debug] Anthropic local preflight", stats);
  return { evidence: prepared.evidence, originalEvidence: evidence, stats };
}

export function requestFingerprint({ claim, manifest, files, provider, model }) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({ claim_id: claim?.id, manifest, provider, model }));
  files.forEach((file) => hash.update(file.buffer));
  return hash.digest("hex");
}

export function issueAnthropicPreflightToken(fingerprint, stats = null, originalEvidence = null) {
  const now = Date.now();
  for (const [existingToken, record] of preflightTokens.entries()) {
    if (record.expiresAt < now) {
      preflightTokens.delete(existingToken);
    } else if (record.fingerprint === fingerprint) {
      return existingToken;
    }
  }
  const token = crypto.randomUUID();
  // The full analysis runs immediately after preflight. Reusing this already
  // extracted evidence prevents a second PDF render cycle and its peak-memory
  // spike; the one-time token is consumed after that request.
  preflightTokens.set(token, { fingerprint, stats, originalEvidence, expiresAt: now + PREFLIGHT_TTL_MS });
  return token;
}

export function consumeAnthropicPreflightToken(token, fingerprint) {
  const record = preflightTokens.get(String(token || ""));
  preflightTokens.delete(String(token || ""));
  if (!record) {
    throw new AnthropicPreflightError("A successful Anthropic preflight is required before full analysis.", {
      status: 412,
      code: "anthropic-preflight-required",
    });
  }
  if (record.expiresAt < Date.now()) {
    throw new AnthropicPreflightError("The Anthropic preflight expired. Run the safety check again.", {
      status: 412,
      code: "anthropic-preflight-expired",
    });
  }
  if (record.fingerprint !== fingerprint) {
    throw new AnthropicPreflightError("The claim payload changed after preflight. Run the safety check again.", {
      status: 412,
      code: "anthropic-preflight-payload-changed",
    });
  }
  return record;
}
