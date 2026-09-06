import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { AutonomousAdjusterOrchestrator } from "./orchestrator.mjs";
import { getClaimDossier, clearClaimDossier } from "./dossierStore.mjs";
import { getAgentConfig, setAgentConfig } from "./agentConfig.mjs";
import { UPLOADS_DIR } from "../../db/diskDb.mjs";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 25 },
});

export function createAgentRouter() {
  const router = express.Router();

  /**
   * POST /api/agent/claims/:claimId/run
   * Runs the Autonomous Loss Adjuster Agent pipeline on a claim.
   */
  router.post("/claims/:claimId/run", upload.array("files"), async (req, res) => {
    try {
      const { claimId } = req.params;
      let claim = {};
      try {
        claim = typeof req.body.claim === "string" ? JSON.parse(req.body.claim) : (req.body.claim || {});
      } catch {
        claim = { id: claimId };
      }
      claim.id = claimId;

      const mode = req.body.mode || (await getAgentConfig()).mode || "hybrid";
      let files = req.files || [];

      // If no files uploaded directly in request, check if documents are stored on disk
      if (files.length === 0 && Array.isArray(claim.documents) && claim.documents.length > 0) {
        for (const doc of claim.documents) {
          const key = doc.storage_key || doc.file_name || doc.name;
          if (!key) continue;
          const safeKey = path.basename(key);
          const diskPath = path.resolve(UPLOADS_DIR, safeKey);
          if (fs.existsSync(diskPath)) {
            try {
              const buffer = fs.readFileSync(diskPath);
              files.push({
                originalname: doc.file_name || safeKey,
                buffer,
                mimetype: doc.file_mime_type || "application/pdf",
                size: buffer.length,
              });
            } catch {
              // skip unreadable file
            }
          }
        }
      }

      const orchestrator = new AutonomousAdjusterOrchestrator({ claim, files, mode });
      const report = await orchestrator.execute();

      return res.json({ ok: true, report });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/agent/claims/:claimId/dossier
   * Retrieves the cached intermediate dossier for a claim.
   */
  router.get("/claims/:claimId/dossier", async (req, res) => {
    try {
      const dossier = await getClaimDossier(req.params.claimId);
      return res.json({ ok: true, dossier });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * DELETE /api/agent/claims/:claimId/dossier
   * Clears the cached dossier to force fresh reading.
   */
  router.delete("/claims/:claimId/dossier", async (req, res) => {
    try {
      await clearClaimDossier(req.params.claimId);
      return res.json({ ok: true, message: "Dossier cache cleared." });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/agent/config
   * Retrieves global agent operational settings.
   */
  router.get("/config", async (_req, res) => {
    try {
      const config = await getAgentConfig();
      return res.json({ ok: true, config });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/agent/config
   * Updates global agent operational settings.
   */
  router.post("/config", async (req, res) => {
    try {
      const updated = await setAgentConfig(req.body || {});
      return res.json({ ok: true, config: updated });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
}
