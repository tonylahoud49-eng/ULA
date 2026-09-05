import { documentStorage } from "./documentStorage.js";
import { analysisSingleFlightKey, runAnalysisSingleFlight } from "./analysisSingleFlight.js";
import { getReportTemplate } from "../lib/reportTemplates.js";

const createRequestError = (message, status, code) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.response = { data: { error: message, code }, status };
  return error;
};

const numericFields = new Set([
  "policy_limit",
  "insured_value",
  "valuation_uplift_percent",
  "valuation_uplift_amount",
  "deductible",
  "claim_amount",
  "gross_claim_amount",
  "invoice_total",
  "freight_amount",
  "insurance_amount",
  "fob_value",
  "freight_invoice_total",
  "fees_amount",
  "salvage_amount",
  "recovery_amount",
  "depreciation_amount",
  "adjusted_amount",
]);

const usableValue = (field) => {
  const value = field.normalized_value ?? field.value;
  if (value === null || value === "") return undefined;
  if (!numericFields.has(field.field)) return value;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : undefined;
};

const confidencePercent = (value) => {
  const numeric = Number(String(value ?? "").replace(/%$/, "").trim());
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  if (numeric <= 1) return Math.round(numeric * 100);
  if (numeric <= 100) return Math.round(numeric);
  return 0;
};

export function mapAnalysis(result) {
  const raw = result.analysis;
  const suggestedBusinessLine = raw.classification.business_line === "Other / Requires Review"
    ? "Requires Review"
    : raw.classification.business_line;
  const reportTemplate = getReportTemplate(suggestedBusinessLine);
  const suggestedClaimData = Object.fromEntries(
    raw.fields
      .map((field) => [field.field, usableValue(field)])
      .filter(([, value]) => value !== undefined),
  );
  if (suggestedBusinessLine !== "Requires Review") suggestedClaimData.business_line = suggestedBusinessLine;

  const provenance = [];
  const appendSources = (label, sources) => sources.forEach((source) => {
    provenance.push({
      id: `E-${String(provenance.length + 1).padStart(2, "0")}`,
      field: label,
      source: source.document_name,
      document_id: source.document_id,
      page: source.page,
      matched_text: source.supporting_text,
      confidence: `${confidencePercent(source.confidence)}% AI confidence`,
      review_state: source.page ? `Page ${source.page}` : "Source location recorded",
      evidence_mode: source.evidence_mode,
    });
  });
  appendSources(`Business line: ${suggestedBusinessLine}`, raw.classification.sources);
  raw.document_types.forEach((type) => appendSources(`Document type: ${type.document_type}`, type.sources));
  raw.fields.filter((field) => field.value !== null).forEach((field) => appendSources(`Field: ${field.field.replaceAll("_", " ")}`, field.sources));
  raw.evidence_findings.forEach((finding, index) => appendSources(
    `Analysis: ${(finding.analysis_domain || "general").replaceAll("_", " ")} ${index + 1}`,
    finding.sources,
  ));
  (raw.adjustment_line_items || []).forEach((item, index) => appendSources(
    `Adjustment item ${index + 1}: ${item.description}`,
    item.sources,
  ));

  return {
    status: "completed",
    provider: result.provider,
    model: result.model,
    response_id: result.response_id,
    provider_api_status: result.provider_api_status,
    analyzed_at: result.analyzed_at,
    business_line: suggestedBusinessLine,
    template_id: reportTemplate.id,
    template_name: reportTemplate.name,
    confidence: confidencePercent(raw.classification.confidence),
    summary: raw.summary,
    missing_documents: raw.missing_documents.map((item) => item.document_type),
    missing_document_details: raw.missing_documents,
    document_types: raw.document_types,
    document_type_evidence: raw.document_types.flatMap((type) => type.sources.map((source) => ({
      document_type: type.document_type,
      confidence: type.confidence,
      document_id: source.document_id,
      document_name: source.document_name,
      page: source.page,
      extracted_text: source.supporting_text,
      evidence_mode: source.evidence_mode,
    }))),
    extracted_fields: raw.fields,
    adjustment_line_items: raw.adjustment_line_items || [],
    suggested_claim_data: suggestedClaimData,
    evidence_sources: provenance,
    evidence_findings: raw.evidence_findings,
    warnings: raw.warnings,
    human_review_required: raw.human_review_required,
    classification_rationale: raw.classification.rationale,
    evidence_snapshot: Array.isArray(result.evidence_snapshot) ? result.evidence_snapshot : [],
    usage: result.usage || null,
  };
}

export async function getActiveAIStatus() {
  try {
    const res = await fetch("/api/ai/status");
    if (res.ok) return await res.json();
    const { body } = await readResponseBody(res);
    return {
      configured: false,
      provider: null,
      model: null,
      configured_providers: [],
      status_error: body.error || `The analysis server returned HTTP ${res.status}.`,
    };
  } catch {
    return {
      configured: false,
      provider: null,
      model: null,
      configured_providers: [],
      status_error: "The local analysis server is not running. Start the app with npm run dev.",
    };
  }
}

const readResponseBody = async (response) => {
  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = {};
  }
  return { body, responseText };
};

async function analyzeClaimWithProviderOnce({ claim, documents, provider, model, disable_fallback, onPreflight }) {
  let statusResponse;
  try {
    statusResponse = await fetch("/api/ai/status");
  } catch {
    throw createRequestError(
      "AI analysis unavailable — the local analysis server is not running. Start the app with npm run dev.",
      503,
      "ai-server-unavailable",
    );
  }
  if (!statusResponse.ok) {
    const { body } = await readResponseBody(statusResponse);
    const message = statusResponse.status === 401 || statusResponse.status === 403
      ? "AI analysis unavailable — your session is no longer valid. Sign in again and retry."
      : `AI analysis unavailable — ${body.error || `the analysis server status check returned HTTP ${statusResponse.status}.`}`;
    throw createRequestError(message, statusResponse.status, body.code || "ai-server-unavailable");
  }
  const status = await statusResponse.json();
  const resolvedProvider = provider || status.provider;
  const configuredSelection = status.configured_providers?.find((item) => item.provider === resolvedProvider);
  const resolvedModel = model || configuredSelection?.model || (resolvedProvider === status.provider ? status.model : null);
  const manifest = [];
  const storedFiles = [];

  for (const document of documents) {
    let stored;
    try {
      stored = await documentStorage.get(document.storage_key || document.file_url);
    } catch (error) {
      throw createRequestError(
        `AI analysis unavailable — ${document.file_name || "An uploaded document"} is not available in browser document storage.`,
        409,
        error.code || "evidence-unavailable",
      );
    }
    const index = manifest.length;
    const fileName = document.file_name || stored.name || `document-${index + 1}`;
    storedFiles.push({ blob: stored.blob, fileName });
    manifest.push({
      index,
      id: document.id,
      file_name: fileName,
      file_mime_type: document.file_mime_type || stored.mimeType || stored.blob.type,
      file_type: document.file_type,
      category: document.category,
    });
  }

  const buildForm = ({ preflightToken } = {}) => {
    const form = new FormData();
    storedFiles.forEach((file) => form.append("files", file.blob, file.fileName));
    form.append("claim", JSON.stringify(claim));
    form.append("manifest", JSON.stringify(manifest));
    if (resolvedProvider) form.append("provider", resolvedProvider);
    if (resolvedModel) form.append("model", resolvedModel);
    if (disable_fallback || resolvedProvider === "anthropic") form.append("disable_fallback", "true");
    if (preflightToken) form.append("preflight_token", preflightToken);
    return form;
  };

  let preflightToken;
  if (resolvedProvider === "anthropic") {
    let preflightResponse;
    try {
      preflightResponse = await fetch("/api/ai/preflight", { method: "POST", body: buildForm() });
    } catch {
      throw createRequestError(
        "Anthropic preflight failed — the local analysis server is not running.",
        503,
        "ai-server-unavailable",
      );
    }
    const { body: preflightBody } = await readResponseBody(preflightResponse);
    if (!preflightResponse.ok || !preflightBody.ok) {
      const error = createRequestError(
        preflightBody.error || `Anthropic preflight failed with HTTP ${preflightResponse.status}.`,
        preflightResponse.status,
        preflightBody.code || "anthropic-preflight-failed",
      );
      error.provider = preflightBody.provider;
      error.model = preflightBody.model;
      error.details = preflightBody.error;
      error.providerStatus = preflightBody.provider_status;
      error.preflight = preflightBody.stats;
      throw error;
    }
    preflightToken = preflightBody.preflight_token;
    if (onPreflight) onPreflight({ ...preflightBody.stats, connectivity: preflightBody.connectivity });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  let response;
  try {
    response = await fetch("/api/ai/analyze", { method: "POST", body: buildForm({ preflightToken }) });
  } catch {
    throw createRequestError(
      "AI analysis unavailable — the local analysis server is not running. Start the app with npm run dev.",
      503,
      "ai-server-unavailable",
    );
  }
  const { body, responseText } = await readResponseBody(response);
  if (!response.ok) {
    let detailsText = "";
    if (!body.error && responseText) {
      const stripped = responseText
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      detailsText = stripped ? ` (Details: ${stripped})` : "";
    }
    const message = body.error || `AI analysis unavailable — the analysis request failed with HTTP ${response.status}.${detailsText}`;
    const err = createRequestError(
      message,
      response.status,
      body.code || "ai-analysis-failed",
    );
    err.provider = body.provider;
    err.model = body.model;
    err.details = body.details || detailsText;
    throw err;
  }
  return mapAnalysis(body);
}

export function analyzeClaimWithProvider(options) {
  const key = analysisSingleFlightKey(options);
  return runAnalysisSingleFlight(key, () => analyzeClaimWithProviderOnce(options));
}
