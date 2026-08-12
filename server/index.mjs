import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createConfiguredProvider, getAIStatus } from "./ai/provider.mjs";
import { extractEvidenceFile } from "./evidence/extractEvidence.mjs";
import { loadApprovedStyleReferences } from "./ai/referenceLayer.mjs";

const serverFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(serverFile), "..");
const port = Number(process.env.PORT || 8787);
const maxFiles = Number(process.env.AI_MAX_FILES || 20);
const maxFileBytes = Number(process.env.AI_MAX_FILE_BYTES || 20 * 1024 * 1024);
const maxTotalBytes = Number(process.env.AI_MAX_TOTAL_BYTES || 50 * 1024 * 1024);
const upload = multer({ storage: multer.memoryStorage(), limits: { files: maxFiles, fileSize: maxFileBytes } });
const app = express();

app.disable("x-powered-by");
app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/ai/status", (_request, response) => response.json(getAIStatus()));

app.post("/api/ai/analyze", upload.array("files", maxFiles), async (request, response) => {
  try {
    const { status, provider } = createConfiguredProvider();
    if (!provider) {
      return response.status(503).json({
        error: `AI analysis unavailable — ${status.reason}`,
        code: "ai-provider-unavailable",
        status,
      });
    }

    const claim = JSON.parse(request.body.claim || "{}");
    const manifest = JSON.parse(request.body.manifest || "[]");
    const files = request.files || [];
    if (!claim.id) return response.status(400).json({ error: "A valid claim is required.", code: "invalid-claim" });
    if (!files.length || files.length !== manifest.length) {
      return response.status(400).json({ error: "Every registered evidence item must include its uploaded file.", code: "incomplete-evidence-set" });
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > maxTotalBytes) {
      return response.status(413).json({ error: "The complete evidence set is too large for one analysis request.", code: "evidence-set-too-large" });
    }

    const evidence = await Promise.all(files.map((file, index) => extractEvidenceFile(file, { ...manifest[index], index })));
    const styleReferences = await loadApprovedStyleReferences(process.env.ULA_REPORT_REFERENCE_DIR);
    const result = await provider.analyze({ claim, evidence, files, styleReferences });
    const extractionWarnings = evidence
      .filter((item) => item.warning || item.extraction_status === "unsupported" || item.extraction_status === "failed")
      .map((item) => `${item.document_name}: ${item.warning || "The file content could not be extracted or sent for vision analysis."}`);
    result.analysis.warnings = [...new Set([...result.analysis.warnings, ...extractionWarnings])];
    return response.json({
      ...result,
      evidence_register: evidence.map(({ pages: _pages, embedded_images: _embeddedImages, ...item }) => item),
    });
  } catch (error) {
    const isProviderError = Number(error?.status) >= 400;
    const statusCode = isProviderError ? 502 : 500;
    const providerMessage = error?.status === 401
      ? "AI provider credentials were rejected. Check the server configuration."
      : error?.status === 429
        ? "The AI provider rate or usage limit was reached. Try again later or review the provider account."
        : "The AI provider could not complete this evidence analysis.";
    return response.status(statusCode).json({
      error: `AI analysis unavailable — ${isProviderError ? providerMessage : error.message || providerMessage}`,
      code: "ai-analysis-failed",
    });
  }
});

app.use((error, _request, response, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    return response.status(413).json({ error: `AI analysis unavailable — ${error.message}`, code: "upload-limit" });
  }
  return response.status(500).json({ error: "AI analysis unavailable — the analysis server failed.", code: "server-error" });
});

const dist = path.join(root, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(dist, "index.html"));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(serverFile)) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`ULA application server listening on http://127.0.0.1:${port}`);
  });
}

export default app;
