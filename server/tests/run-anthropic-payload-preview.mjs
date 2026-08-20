import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAnthropicClaimLocally } from "../ai/anthropicPreflight.mjs";
import { loadApprovedStyleReferences } from "../ai/referenceLayer.mjs";

const inputPaths = process.argv.slice(2);
if (!inputPaths.length) {
  throw new Error("Provide one or more local evidence file paths. This command never calls Anthropic.");
}

const mimeTypes = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".eml": "message/rfc822",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".txt": "text/plain",
};

const files = await Promise.all(inputPaths.map(async (inputPath) => {
  const resolved = path.resolve(inputPath);
  const buffer = await fs.readFile(resolved);
  return {
    originalname: path.basename(resolved),
    mimetype: mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream",
    size: buffer.length,
    buffer,
  };
}));
const manifest = files.map((file, index) => ({
  index,
  id: `preview-document-${index + 1}`,
  file_name: file.originalname,
  file_mime_type: file.mimetype,
  file_type: "Other",
  category: "Other",
}));
const currentFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFile), "..", "..");
const styleReferences = await loadApprovedStyleReferences(
  process.env.ULA_REPORT_REFERENCE_DIR || path.join(root, "server", "ai", "references"),
);
const preview = await validateAnthropicClaimLocally({
  claim: { id: "local-payload-preview", title: "Local Anthropic payload preview" },
  manifest,
  files,
  styleReferences,
});

console.log(JSON.stringify({
  anthropic_called: false,
  provider: preview.stats.selected_provider,
  model: preview.stats.selected_model,
  claim_context_fields: preview.stats.claim_context_fields,
  document_count: preview.stats.document_count,
  extracted_text_characters: preview.stats.extracted_text_characters,
  sent_text_characters: preview.stats.sent_text_characters,
  sent_visual_count: preview.stats.sent_visual_count,
  raw_pdf_files_sent: preview.stats.raw_pdf_files_sent,
  estimated_request_bytes: preview.stats.estimated_request_bytes,
  estimated_input_tokens: preview.stats.estimated_input_tokens,
  max_output_tokens: preview.stats.max_output_tokens,
  configured_limits: preview.stats.limits,
  local_reduction: preview.stats.local_reduction,
  payload_summary: preview.stats.payload_summary,
}, null, 2));
