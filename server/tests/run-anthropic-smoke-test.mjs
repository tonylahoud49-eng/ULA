import fs from "node:fs/promises";
import path from "node:path";
import app from "../index.mjs";

const evidenceDirectory = path.resolve("samples/test-evidence/air-cargo");
const evidenceNames = (await fs.readdir(evidenceDirectory)).sort();
const externalBaseUrl = process.env.AI_SMOKE_BASE_URL;
const listener = externalBaseUrl ? null : await new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

try {
  const address = listener?.address();
  const baseUrl = externalBaseUrl || `http://127.0.0.1:${address.port}`;
  const providerStatus = await fetch(`${baseUrl}/api/ai/status`).then((response) => response.json());
  const form = new FormData();
  const manifest = [];

  for (const [index, name] of evidenceNames.entries()) {
    const buffer = await fs.readFile(path.join(evidenceDirectory, name));
    const mimeType = name.endsWith(".csv") ? "text/csv" : "text/plain";
    form.append("files", new Blob([buffer], { type: mimeType }), name);
    manifest.push({
      index,
      id: `smoke-document-${index + 1}`,
      file_name: name,
      file_mime_type: mimeType,
      category: "Other",
    });
  }
  form.append("claim", JSON.stringify({ id: "anthropic-smoke-claim", claim_number: "SMOKE-ANTHROPIC" }));
  form.append("manifest", JSON.stringify(manifest));

  const response = await fetch(`${baseUrl}/api/ai/analyze`, { method: "POST", body: form });
  const body = await response.json();
  const summary = {
    endpoint_status: response.status,
    configured_provider: providerStatus.provider,
    configured_model: providerStatus.model,
    response_provider: body.provider || null,
    response_model: body.model || null,
    provider_api_status: body.provider_api_status || body.provider_status || null,
    provider_response_id: body.response_id || body.provider_request_id || null,
    uploaded_document_count: evidenceNames.length,
    analyzed_document_count: body.evidence_register?.length || 0,
    extraction_statuses: body.evidence_register?.map((item) => ({
      document: item.document_name,
      status: item.extraction_status,
    })) || [],
    classification: body.analysis?.classification || null,
    extracted_supported_field_count: body.analysis?.fields?.filter((field) => field.value !== null).length || 0,
    detected_document_types: body.analysis?.document_types?.map((item) => item.document_type) || [],
    missing_document_count: body.analysis?.missing_documents?.length || 0,
    missing_document_types: body.analysis?.missing_documents?.map((item) => item.document_type) || [],
    error: body.error || null,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!response.ok) process.exitCode = 1;
} finally {
  if (listener) {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
}
