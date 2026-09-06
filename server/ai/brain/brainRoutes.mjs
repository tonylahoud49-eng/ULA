import express from "express";
import multer from "multer";
import {
  getBrainManifest,
  getBrainStyleReferences,
  learnFromOfficialReport,
  purgeBrainProfile,
  removeBrainRule,
} from "./brainEngine.mjs";
import { extractEvidenceFile } from "../../evidence/extractEvidence.mjs";

const upload = multer({
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  storage: multer.memoryStorage(),
});

export function createBrainRouter() {
  const router = express.Router();

  /**
   * GET /api/ai/brain/status
   * Returns metadata and statistics on the Brain's learned reports and profiles.
   */
  router.get("/status", async (req, res) => {
    try {
      const manifest = await getBrainManifest();
      return res.json({
        ok: true,
        manifest,
        total_learned_reports: manifest.total_learned_reports || 0,
        business_lines: manifest.business_lines || {},
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Failed to retrieve brain status.",
      });
    }
  });

  /**
   * GET /api/ai/brain/profiles
   * Returns the list of learned profiles and knowledge references.
   */
  router.get("/profiles", async (req, res) => {
    try {
      const profiles = await getBrainStyleReferences();
      return res.json({
        ok: true,
        profiles,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Failed to load brain profiles.",
      });
    }
  });

  /**
   * POST /api/ai/brain/learn-report
   * Ingests an official final loss adjuster report, extracts methodology, and stores into the brain.
   */
  router.post("/learn-report", upload.single("file"), async (req, res) => {
    try {
      let claim = {};
      try {
        claim = typeof req.body?.claim === "string" ? JSON.parse(req.body.claim) : (req.body?.claim || {});
      } catch {
        return res.status(400).json({ error: "Valid claim data is required.", code: "invalid-claim" });
      }

      let evidence = [];
      try {
        evidence = typeof req.body?.evidence === "string" ? JSON.parse(req.body.evidence) : (req.body?.evidence || []);
      } catch {
        evidence = [];
      }

      let officialReportText = req.body?.report_text || "";
      let officialReportFileName = req.body?.file_name || "official_report.pdf";

      if (req.file) {
        officialReportFileName = req.file.originalname || officialReportFileName;
        const extracted = await extractEvidenceFile(req.file, { file_name: officialReportFileName });
        officialReportText = (extracted.pages || []).map((p) => p.text).join("\n\n");
      }

      if (!officialReportText || officialReportText.trim().length < 50) {
        return res.status(400).json({
          error: "The official report document could not be read or is empty.",
          code: "empty-report-text",
        });
      }

      const providerName = req.body?.provider || undefined;
      const modelName = req.body?.model || undefined;

      const result = await learnFromOfficialReport({
        claim,
        officialReportText,
        officialReportFileName,
        evidence,
        providerName,
        modelName,
      });

      return res.json({
        ok: true,
        message: `Successfully ingested and learned official report for ${result.business_line}.`,
        ...result,
      });
    } catch (error) {
      console.error("[ULA Brain Error]", error);
      return res.status(500).json({
        ok: false,
        error: error.message || "Brain learning execution failed.",
        code: "brain-learning-failed",
      });
    }
  });

  /**
   * DELETE /api/ai/brain/profiles/:businessLine
   * Purges/resets learned knowledge for a specific business line.
   */
  router.delete("/profiles/:businessLine", async (req, res) => {
    try {
      const { businessLine } = req.params;
      const result = await purgeBrainProfile(businessLine);
      return res.json({ ok: true, message: `Profile for ${businessLine} purged successfully.`, ...result });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || "Failed to purge profile." });
    }
  });

  /**
   * DELETE /api/ai/brain/profiles/:businessLine/rules
   * Removes an individual rule from a business line profile by category and index.
   */
  router.delete("/profiles/:businessLine/rules", async (req, res) => {
    try {
      const { businessLine } = req.params;
      const { category, rule_index } = req.body || {};
      if (!category || rule_index === undefined) {
        return res.status(400).json({ error: "category and rule_index are required.", code: "invalid-parameters" });
      }
      const result = await removeBrainRule(businessLine, category, rule_index);
      return res.json({ ok: true, message: "Rule removed successfully.", ...result });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || "Failed to remove rule." });
    }
  });

  return router;
}
