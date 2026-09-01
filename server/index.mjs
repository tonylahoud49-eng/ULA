import dotenv from "dotenv";
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
import { sendTestEmail, getEmailDiagnosticsStatus } from "./email/emailTestService.mjs";

if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

const serverFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(serverFile), "..");
const port = Number(process.env.PORT || 8090);
const maxFiles = Number(process.env.AI_MAX_FILES || 20);
const maxFileBytes = Number(process.env.AI_MAX_FILE_BYTES || 20 * 1024 * 1024);
const maxTotalBytes = Number(process.env.AI_MAX_TOTAL_BYTES || 50 * 1024 * 1024);
const upload = multer({ storage: multer.memoryStorage(), limits: { files: maxFiles, fileSize: maxFileBytes } });
const app = express();
const getLeaveEmailService = () => {
  if (process.env.NODE_ENV !== "test") {
    dotenv.config();
  }
  return createLeaveEmailService({ env: process.env });
};
const anthropicAnalysisRequests = new Map();
const anthropicAnalysisCacheMs = Number(process.env.ANTHROPIC_DUPLICATE_CACHE_MS || 10 * 60 * 1000);

app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));

import { diskDb, UPLOADS_DIR, DATA_DIR, ensureDirectories, ENTITY_NAMES } from "./db/diskDb.mjs";

ensureDirectories();

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeName = (file.originalname || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${unique}_${safeName}`);
  },
});
const diskUpload = multer({ storage: diskStorage, limits: { fileSize: maxFileBytes, files: maxFiles } });

// --- Entity REST Endpoints ---
app.get("/api/entities/:entity", (request, response) => {
  const { entity } = request.params;
  if (!ENTITY_NAMES.includes(entity)) {
    return response.status(400).json({ error: `Unknown entity: ${entity}` });
  }
  try {
    const items = diskDb.list(entity, request.query);
    return response.json(items);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.get("/api/entities/:entity/:id", (request, response) => {
  const { entity, id } = request.params;
  if (!ENTITY_NAMES.includes(entity)) {
    return response.status(400).json({ error: `Unknown entity: ${entity}` });
  }
  try {
    const item = diskDb.get(entity, id);
    if (!item) return response.status(404).json({ error: `Not found` });
    return response.json(item);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.post("/api/entities/:entity", (request, response) => {
  const { entity } = request.params;
  if (!ENTITY_NAMES.includes(entity)) {
    return response.status(400).json({ error: `Unknown entity: ${entity}` });
  }
  try {
    const created = diskDb.create(entity, request.body || {});
    return response.status(201).json(created);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.put("/api/entities/:entity/:id", (request, response) => {
  const { entity, id } = request.params;
  if (!ENTITY_NAMES.includes(entity)) {
    return response.status(400).json({ error: `Unknown entity: ${entity}` });
  }
  try {
    const updated = diskDb.update(entity, id, request.body || {});
    return response.json(updated);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.delete("/api/entities/:entity/:id", (request, response) => {
  const { entity, id } = request.params;
  if (!ENTITY_NAMES.includes(entity)) {
    return response.status(400).json({ error: `Unknown entity: ${entity}` });
  }
  try {
    const deleted = diskDb.delete(entity, id);
    if (!deleted) return response.status(404).json({ error: "Not found" });
    return response.json(deleted);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

// --- Document Physical Storage Endpoints ---
app.post("/api/documents/upload", diskUpload.single("file"), (request, response) => {
  if (!request.file) {
    return response.status(400).json({ error: "No file provided in request" });
  }

  const { filename, originalname, mimetype, size } = request.file;
  const storageKey = filename;
  const fileUrl = `/api/documents/file/${filename}`;

  return response.status(201).json({
    storage_key: storageKey,
    file_url: fileUrl,
    file_name: originalname,
    file_size: size,
    file_mime_type: mimetype,
    storage_provider: "server_disk",
    reference: `server-document:${storageKey}`,
  });
});

app.get("/api/documents/file/:filename", (request, response) => {
  try {
    const { filename } = request.params;
    const safeFilename = path.basename(filename);
    const filePath = path.resolve(UPLOADS_DIR, safeFilename);

    if (!fs.existsSync(filePath)) {
      return response.status(404).json({ error: "Document file not found on server" });
    }

    const stat = fs.statSync(filePath);
    response.setHeader("Content-Length", stat.size);
    response.setHeader("Cache-Control", "public, max-age=86400");
    if (safeFilename.endsWith(".pdf")) {
      response.setHeader("Content-Type", "application/pdf");
    } else if (safeFilename.endsWith(".docx")) {
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } else if (safeFilename.endsWith(".xlsx")) {
      response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } else if (safeFilename.endsWith(".png")) {
      response.setHeader("Content-Type", "image/png");
    } else if (safeFilename.endsWith(".jpg") || safeFilename.endsWith(".jpeg")) {
      response.setHeader("Content-Type", "image/jpeg");
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", (streamErr) => {
      if (!response.headersSent) {
        response.status(500).json({ error: streamErr.message });
      }
    });
    return stream.pipe(response);
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.get("/api/documents/:key", (request, response) => {
  const { key } = request.params;
  const safeKey = path.basename(key);
  const filePath = path.join(UPLOADS_DIR, safeKey);

  if (!fs.existsSync(filePath)) {
    return response.status(404).json({ error: "Document not found" });
  }

  const stats = fs.statSync(filePath);
  return response.json({
    storage_key: safeKey,
    file_url: `/api/documents/file/${safeKey}`,
    size: stats.size,
    updated_at: stats.mtime.toISOString(),
  });
});

app.delete("/api/documents/:key", (request, response) => {
  const { key } = request.params;
  const safeKey = path.basename(key);
  const filePath = path.join(UPLOADS_DIR, safeKey);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return response.json({ ok: true, deleted: safeKey });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

// Full DB sync backward compatibility
app.get("/api/db", (_request, response) => {
  try {
    return response.json(diskDb.getClaimsDb());
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.post("/api/db", (request, response) => {
  try {
    const payload = request.body || {};
    diskDb.setFullClaimsDb(payload);
    return response.json({ ok: true, timestamp: Date.now() });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.get("/api/auth-db", (_request, response) => {
  try {
    return response.json(diskDb.getAuthDb());
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

app.post("/api/auth-db", (request, response) => {
  try {
    const payload = request.body || {};
    diskDb.setFullAuthDb(payload);
    return response.json({ ok: true });
  } catch (err) {
    return response.status(500).json({ error: err.message });
  }
});

const LOGS_FILE = path.join(DATA_DIR, "ai_logs.json");

function loadAiLogs() {
  ensureDirectories();
  try {
    if (fs.existsSync(LOGS_FILE)) {
      const data = fs.readFileSync(LOGS_FILE, "utf-8");
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // fallback
  }
  return [];
}

const AI_LOGS = loadAiLogs();

function persistAiLogs() {
  ensureDirectories();
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(AI_LOGS, null, 2), "utf-8");
  } catch {
    // file write should not throw
  }
}

export function logAiEvent(level, message, data = null) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    data: data ? JSON.parse(JSON.stringify(data)) : null,
  };
  AI_LOGS.unshift(entry);
  if (AI_LOGS.length > 200) AI_LOGS.pop();
  persistAiLogs();
  try {
    console.log(`[AI ${level.toUpperCase()}] ${message}`, data ? JSON.stringify(data) : "");
  } catch {
    // Console logging must never affect request processing
  }
}

app.get("/api/ai/logs", (_request, response) => response.json({ ok: true, logs: AI_LOGS }));
app.delete("/api/ai/logs", (_request, response) => {
  AI_LOGS.length = 0;
  persistAiLogs();
  return response.json({ ok: true });
});

app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/ai/status", (_request, response) => response.json(getAIStatus()));
app.get("/api/leave/email/status", (_request, response) => response.json(getLeaveEmailService().getStatus()));
app.get("/api/email/diagnostics", (_request, response) => {
  dotenv.config({ override: true });
  return response.json(getEmailDiagnosticsStatus(process.env));
});

app.post("/api/ai/test-chat", async (request, response) => {
  const startTime = Date.now();
  const { provider = "openrouter", model = "openrouter/auto", prompt = "Hello, respond with a quick test acknowledgement and your active model name." } = request.body || {};

  try {
    dotenv.config({ override: true });
    let reply = "";
    let routedModel = model;
    let usage = null;

    if (provider === "openrouter" || provider.startsWith("openrouter:")) {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("OPENROUTER_API_KEY is not configured in .env");
      const actualModel = (model || "").replace(/^openrouter:/, "") || "openrouter/auto";

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: actualModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 150,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || `OpenRouter returned HTTP ${res.status}`);
      }
      routedModel = data.model || actualModel;
      reply = data.choices?.[0]?.message?.content?.trim() || "(No response content returned)";
      usage = data.usage || null;
    } else if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY is not configured in .env");
      const actualModel = model || process.env.GEMINI_MODEL || "gemini-3.6-flash";

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Gemini returned HTTP ${res.status}`);
      }
      reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(No response content returned)";
    } else if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not configured in .env");
      const actualModel = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: actualModel,
          max_tokens: 150,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Anthropic returned HTTP ${res.status}`);
      }
      reply = data.content?.[0]?.text?.trim() || "(No response content returned)";
    } else {
      throw new Error(`Testing for provider '${provider}' is not supported yet.`);
    }

    const elapsed = Date.now() - startTime;
    return response.json({
      ok: true,
      provider,
      model: routedModel,
      reply,
      latency_ms: elapsed,
      usage,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    return response.status(200).json({
      ok: false,
      error: error.message || "Model test ping failed.",
      latency_ms: elapsed,
      model,
      provider,
    });
  }
});

app.post("/api/email/test", async (request, response) => {
  try {
    dotenv.config({ override: true });
    const configuredBaseUrl = String(process.env.APP_BASE_URL || "").trim();
    const requestOrigin = request.get("origin");
    if (configuredBaseUrl && requestOrigin) {
      try {
        if (new URL(configuredBaseUrl).origin !== requestOrigin) {
          return response.status(403).json({ error: "Email test requests must originate from the configured ULA application.", code: "email-test-origin-rejected" });
        }
      } catch {
        // Continue to validator
      }
    }
    const result = await sendTestEmail(request.body);
    return response.json(result);
  } catch (error) {
    return response.status(Number(error.status) || 502).json({
      ok: false,
      error: error.message || "Failed to send test email.",
      code: error.code || "email-test-failed",
    });
  }
});

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
    const resolvedModel = requestedModel || configuration.model;
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
      model: resolvedModel,
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
    const delivery = await getLeaveEmailService().sendEvent(request.body);
    return response.json({ delivery });
  } catch (error) {
    return response.status(Number(error.status) || 502).json({
      error: error.message || "Could not send the leave notification email.",
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

    logAiEvent("info", `Analysis requested for ${claim.title || claim.id || "claim"}`, {
      provider: provider.name,
      model: provider.model,
      files: files.length,
      file_names: files.map((f) => f.originalname || f.name),
    });

    const evidence = await Promise.all(files.map((file, index) => extractEvidenceFile(file, { ...manifest[index], index })));
    const totalExtractedChars = evidence.reduce((sum, item) => sum + evidenceText(item).length, 0);
    logAiEvent("info", `Extracted ${evidence.length} evidence document(s) (${totalExtractedChars.toLocaleString()} characters)`, {
      documents: evidence.map((item) => ({
        name: item.document_name,
        kind: item.kind,
        status: item.extraction_status,
        length: evidenceText(item).length,
      })),
    });

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

    logAiEvent("info", `Sending evidence payload to ${provider.name} (${provider.model})...`);
    const result = await provider.analyze({ claim, evidence, files, styleReferences });

    logAiEvent("info", `Received successful analysis from ${provider.name} (${provider.model})`, {
      business_line: result.analysis?.classification?.business_line,
      confidence: result.analysis?.classification?.confidence,
      summary_preview: (result.analysis?.summary || "").slice(0, 160),
    });

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
    
    logAiEvent("error", `Analysis failed with ${errorProvider} [${errorModel}]: ${error.message}`, {
      status: error?.status || statusCode,
      details: error.message,
    });
    
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
