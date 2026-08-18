import { documentStorage } from "@/api/documentStorage";
import { getReportTemplate } from "@/lib/reportTemplates";

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
  if (value === null || value === "" || field.requires_confirmation) return undefined;
  if (!numericFields.has(field.field)) return value;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : undefined;
};

function mapAnalysis(result) {
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
      confidence: `${Math.round(source.confidence * 100)}% AI confidence`,
      review_state: source.page ? `Page ${source.page}` : "Source location recorded",
      evidence_mode: source.evidence_mode,
    });
  });
  appendSources(`Business line: ${suggestedBusinessLine}`, raw.classification.sources);
  raw.document_types.forEach((type) => appendSources(`Document type: ${type.document_type}`, type.sources));
  raw.fields.filter((field) => field.value !== null).forEach((field) => appendSources(`Field: ${field.field.replaceAll("_", " ")}`, field.sources));

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
    confidence: Math.round(raw.classification.confidence * 100),
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
  };
}

export async function analyzeClaimWithProvider({ claim, documents }) {
  const form = new FormData();
  const manifest = [];

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
    form.append("files", stored.blob, fileName);
    manifest.push({
      index,
      id: document.id,
      file_name: fileName,
      file_mime_type: document.file_mime_type || stored.mimeType || stored.blob.type,
      file_type: document.file_type,
      category: document.category,
    });
  }

  form.append("claim", JSON.stringify(claim));
  form.append("manifest", JSON.stringify(manifest));
  let response;
  try {
    response = await fetch("/api/ai/analyze", { method: "POST", body: form });
  } catch {
    throw createRequestError(
      "AI analysis unavailable — the local analysis server is not running. Start the app with npm run dev.",
      503,
      "ai-server-unavailable",
    );
  }
  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const nonHtmlDetails = responseText && !/^\s*</.test(responseText)
      ? ` (Details: ${responseText.slice(0, 300)})`
      : "";
    throw createRequestError(
      body.error || `AI analysis unavailable — the analysis request failed with HTTP ${response.status}.${nonHtmlDetails}`,
      response.status,
      body.code || "ai-analysis-failed",
    );
  }
  return mapAnalysis(body);
}
