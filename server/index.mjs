import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createConfiguredProvider, getAIStatus } from "./ai/provider.mjs";
import { safeAiDebugLog } from "./ai/debugLog.mjs";
import {
  AnthropicPreflightError,
  consumeAnthropicPreflightToken,
  issueAnthropicPreflightToken,
  requestFingerprint,
  testAnthropicConnectivity,
  validateAnthropicClaimLocally,
  validateAnthropicConfiguration,
} from "./ai/anthropicPreflight.mjs";
import { extractEvidenceFile, evidenceText } from "./evidence/extractEvidence.mjs";
import { loadApprovedStyleReferences } from "./ai/referenceLayer.mjs";
import { createLeaveEmailService } from "./leave/leaveEmailService.mjs";

const serverFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(serverFile), "..");
const port = Number(process.env.PORT || 8787);
const maxFiles = Number(process.env.AI_MAX_FILES || 20);
const maxFileBytes = Number(process.env.AI_MAX_FILE_BYTES || 20 * 1024 * 1024);
const maxTotalBytes = Number(process.env.AI_MAX_TOTAL_BYTES || 50 * 1024 * 1024);
const upload = multer({ storage: multer.memoryStorage(), limits: { files: maxFiles, fileSize: maxFileBytes } });
const app = express();
const leaveEmailService = createLeaveEmailService();
const anthropicAnalysisRequests = new Map();
const anthropicAnalysisCacheMs = Number(process.env.ANTHROPIC_DUPLICATE_CACHE_MS || 10 * 60 * 1000);

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/ai/status", (_request, response) => response.json(getAIStatus()));
app.get("/api/leave/email/status", (_request, response) => response.json(leaveEmailService.getStatus()));

function anthropicPreflightFailure(response, error) {
  return response.status(Number(error.status) || 500).json({
    ok: false,
    error: error.message || "Anthropic preflight failed.",
    code: error.code || "anthropic-preflight-failed",
    provider: "anthropic",
    model: String(process.env.ANTHROPIC_MODEL || "") || null,
    provider_status: error.providerStatus || null,
    provider_request_id: error.providerRequestId || null,
    stats: error.stats || null,
  });
}

app.post("/api/ai/connectivity", async (_request, response) => {
  try {
    const connectivity = await testAnthropicConnectivity();
    return response.json({ ok: true, server_running: true, connectivity });
  } catch (error) {
    return anthropicPreflightFailure(response, error);
  }
});

app.post("/api/ai/preflight", upload.array("files", maxFiles), async (request, response) => {
  try {
    const configuration = validateAnthropicConfiguration();
    const requestedProvider = String(request.body?.provider || "anthropic").toLowerCase();
    const requestedModel = String(request.body?.model || configuration.model);
    if (requestedProvider !== "anthropic") {
      throw new AnthropicPreflightError("Anthropic preflight cannot validate a different provider.", {
        code: "anthropic-provider-not-selected",
      });
    }
    if (requestedModel !== configuration.model) {
      throw new AnthropicPreflightError("The selected model does not match ANTHROPIC_MODEL.", {
        code: "anthropic-model-mismatch",
      });
    }
    const claim = JSON.parse(request.body.claim || "{}");
    const manifest = JSON.parse(request.body.manifest || "[]");
    const files = request.files || [];
    const styleReferenceDirectory = process.env.ULA_REPORT_REFERENCE_DIR
      || path.join(root, "server", "ai", "references");
    let styleReferences;
    try {
      styleReferences = await loadApprovedStyleReferences(styleReferenceDirectory);
    } catch (error) {
      throw new AnthropicPreflightError(`A required report-reference dependency failed: ${error.message}`, {
        status: 500,
        code: "preflight-dependency-failed",
      });
    }
    const local = await validateAnthropicClaimLocally({ claim, manifest, files, styleReferences });
    const fingerprint = requestFingerprint({
      claim,
      manifest,
      files,
      provider: "anthropic",
      model: configuration.model,
    });
    const preflightToken = issueAnthropicPreflightToken(fingerprint, local.stats);
    return response.json({
      ok: true,
      server_running: true,
      checks: {
        configuration: true,
        uploaded_files: true,
        extracted_text: true,
        request_payload: true,
        payload_limits: true,
        backend_dependencies: true,
        connectivity: "deferred-to-analysis",
      },
      stats: local.stats,
      connectivity: {
        checked: false,
        provider: "anthropic",
        model: configuration.model,
        http_status: null,
        reason: "The automatic run preflight is local-only so one click makes at most one Anthropic request.",
      },
      preflight_token: preflightToken,
    });
  } catch (error) {
    return anthropicPreflightFailure(response, error);
  }
});

app.post("/api/leave/notifications", async (request, response) => {
  try {
    const configuredBaseUrl = String(process.env.APP_BASE_URL || "").trim();
    const requestOrigin = request.get("origin");
    if (configuredBaseUrl && requestOrigin) {
      try {
        if (new URL(configuredBaseUrl).origin !== requestOrigin) {
          return response.status(403).json({ error: "Leave email requests must originate from the configured ULA application.", code: "leave-email-origin-rejected" });
        }
      } catch {
        // The service returns a precise invalid-configuration error below.
      }
    }
    const delivery = await leaveEmailService.sendEvent(request.body);
    return response.json({ delivery });
  } catch (error) {
    return response.status(Number(error.status) || 502).json({
      error: error.message || "Outlook could not send the leave notification.",
      code: error.code || "leave-email-delivery-failed",
      delivery: error.delivery || null,
    });
  }
});

app.post("/api/ai/analyze", upload.array("files", maxFiles), async (request, response) => {
  let activeProviderInfo = null;
  let anthropicFingerprint = null;
  try {
    const requestedProvider = request.body?.provider || undefined;
    const requestedModel = request.body?.model || undefined;
    const isAnthropicRequest = String(requestedProvider || process.env.AI_PROVIDER || "").toLowerCase() === "anthropic";
    const disableFallback = isAnthropicRequest
      || request.body?.disable_fallback === "true"
      || request.body?.disable_fallback === true;
    const { status, provider } = createConfiguredProvider({
      providerName: requestedProvider,
      modelName: requestedModel,
      disableFallback,
    });
    if (!provider) {
      return response.status(503).json({
        error: `AI analysis unavailable — ${status.reason}`,
        code: "ai-provider-unavailable",
        status,
      });
    }
    activeProviderInfo = { provider: provider.name, model: provider.model };

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
    if (isAnthropicRequest) {
      anthropicFingerprint = requestFingerprint({
        claim,
        manifest,
        files,
        provider: "anthropic",
        model: provider.model,
      });
      const preflight = consumeAnthropicPreflightToken(request.body?.preflight_token, anthropicFingerprint);
      const now = Date.now();
      for (const [fingerprint, record] of anthropicAnalysisRequests.entries()) {
        if (record.expiresAt < now) anthropicAnalysisRequests.delete(fingerprint);
      }
      const existing = anthropicAnalysisRequests.get(anthropicFingerprint);
      if (existing?.state === "complete") {
        return response.json({ ...existing.payload, duplicate_request_reused: true });
      }
      if (existing?.state === "in_flight") {
        return response.status(409).json({
          error: "An identical Anthropic analysis request is already in progress.",
          code: "anthropic-duplicate-request",
          provider: "anthropic",
          model: provider.model,
        });
      }
      anthropicAnalysisRequests.set(anthropicFingerprint, {
        state: "in_flight",
        expiresAt: now + anthropicAnalysisCacheMs,
      });
      try {
        console.info("[ULA Anthropic estimate]", {
          model: provider.model,
          document_count: preflight.stats?.document_count || files.length,
          extracted_text_characters: preflight.stats?.extracted_text_characters || null,
          sent_text_characters: preflight.stats?.sent_text_characters || null,
          estimated_input_tokens: preflight.stats?.estimated_input_tokens || null,
          estimated_request_bytes: preflight.stats?.estimated_request_bytes || null,
        });
      } catch {
        // Logging metadata must never affect a paid provider request.
      }
    }

    const evidence = await Promise.all(files.map((file, index) => extractEvidenceFile(file, { ...manifest[index], index })));
    safeAiDebugLog("[ULA AI debug] Extracted evidence", evidence.map((item) => ({
      document_id: item.document_id,
      filename: item.document_name,
      mime_type: item.mime_type,
      uploaded_type: item.category,
      extraction_status: item.extraction_status,
      extracted_content_length: evidenceText(item).length,
      image_only_page_count: item.image_only_page_count || 0,
      vision_pages_included: item.vision_image_count || 0,
    })));
    safeAiDebugLog("[ULA AI debug] AI request", {
      provider: provider.name,
      model: provider.model,
      document_count: evidence.length,
    });
    const styleReferenceDirectory = process.env.ULA_REPORT_REFERENCE_DIR
      || path.join(root, "server", "ai", "references");
    const styleReferences = await loadApprovedStyleReferences(styleReferenceDirectory);
    const result = await provider.analyze({ claim, evidence, files, styleReferences });
    safeAiDebugLog("[ULA AI debug] Detected document categories", evidence.map((item) => ({
      filename: item.document_name,
      detected_categories: result.analysis.document_types
        .filter((type) => type.sources.some((source) => source.document_id === item.document_id))
        .map((type) => type.document_type),
    })));
    const extractionWarnings = evidence
      .filter((item) => item.warning || item.extraction_status === "unsupported" || item.extraction_status === "failed")
      .map((item) => `${item.document_name}: ${item.warning || "The file content could not be extracted or sent for vision analysis."}`);
    result.analysis.warnings = [...new Set([...result.analysis.warnings, ...extractionWarnings])];
    const responsePayload = {
      ...result,
      evidence_register: evidence.map(({ pages: _pages, embedded_images: _embeddedImages, vision_images: _visionImages, ...item }) => item),
      evidence_snapshot: evidence.map((item) => ({
        document_id: item.document_id,
        document_name: item.document_name,
        mime_type: item.mime_type,
        extraction_status: item.extraction_status,
        pages: item.pages,
      })),
    };
    if (anthropicFingerprint) {
      anthropicAnalysisRequests.set(anthropicFingerprint, {
        state: "complete",
        payload: responsePayload,
        expiresAt: Date.now() + anthropicAnalysisCacheMs,
      });
    }
    return response.json(responsePayload);
  } catch (error) {
    if (anthropicFingerprint && anthropicAnalysisRequests.get(anthropicFingerprint)?.state === "in_flight") {
      anthropicAnalysisRequests.delete(anthropicFingerprint);
    }
    if (error instanceof AnthropicPreflightError) return anthropicPreflightFailure(response, error);
    const errorProvider = error?.provider || activeProviderInfo?.provider || "Configured AI Provider";
    const errorModel = error?.model || activeProviderInfo?.model || "model";
    const isNetworkError = /terminated|timed?\s*out|socket|network|fetch failed|connection (?:closed|reset|error)/i.test(error?.message || "");
    const isProviderError = error?.isProviderError || Number(error?.status) >= 400 || isNetworkError;
    const statusCode = isProviderError ? 502 : 500;
    let providerMessage = error?.status === 401
      ? "credentials were rejected. Check API key."
      : error?.status === 404
        ? "model endpoint was not found. Check the model name."
      : error?.status === 429
        ? "rate limit or quota was reached."
        : isNetworkError
          ? "network connection could not be established to the provider API."
        : "could not complete this evidence analysis.";
    
    const details = error?.message ? ` (Details: ${error.message})` : "";
    const fullError = `AI analysis unavailable with ${errorProvider} [${errorModel}] — ${providerMessage}${details}`;
    
    return response.status(statusCode).json({
      error: fullError,
      code: "ai-analysis-failed",
      provider: errorProvider,
      model: errorModel,
      details: error?.message || null,
      provider_status: error?.providerStatus || error?.status || null,
      provider_request_id: error?.providerRequestId || null,
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
