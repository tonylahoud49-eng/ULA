import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { extractEvidenceFile, evidenceText } from "../../evidence/extractEvidence.mjs";
import { learnBrainMethodology } from "./brainLearner.mjs";
import { BRAIN_BUSINESS_LINES, BRAIN_TOPICS, approvedBrainManifest, brainError, brainMetadata, finalReportSubmission } from "./brainPolicy.mjs";
import { assertReportCanBeIssued } from "../../../src/lib/reportEvidenceGate.js";

export function createBrainRouter({ store, requireAccess, requireAdmin, resolveReportVersion, learner = learnBrainMethodology, extract = extractEvidenceFile }) {
  const router = express.Router();
  router.use(requireAccess);
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  const run = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (error) { res.status(error.status || 500).json({ error: error.message || "Brain request failed." }); }
  };
  const required = async (req) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) throw brainError("Invalid report ID.");
    const record = await store.get(req.params.id, req.authUser);
    if (!record) throw brainError("Saved report not found.", 404);
    return record;
  };
  const review = async (req, operation) => {
    await required(req);
    return store.mutate(req.params.id, req.authUser, (record) => {
      if (!Number.isInteger(req.body?.revision) || req.body.revision !== (record.revision || 0)) throw brainError("The report changed. Refresh the library and review its latest state.", 409);
      if (record.status === "learning") throw brainError("Wait for digestion to finish before reviewing this report.", 409);
      return operation(record);
    });
  };
  router.get("/config", (_req, res) => res.json({ business_lines: BRAIN_BUSINESS_LINES, topics: Object.keys(BRAIN_TOPICS) }));
  router.get("/reports", run(async (req, res) => {
    const reports = await store.list(req.authUser);
    const references = await store.references(req.authUser);
    const bank = BRAIN_BUSINESS_LINES.map((line) => {
      const active = references.filter((reference) => reference.applies_to.business_lines.includes(line));
      const submissions = reports.filter((report) => report.business_line === line);
      return { business_line: line, active_reports: active.length, methodology_notes: active.reduce((count, reference) => count + reference.style_notes.length, 0), awaiting_review: submissions.filter((report) => report.approval_status === "submitted" || report.status === "pending").length, preview: active.flatMap((reference) => reference.style_notes).slice(0, 2) };
    });
    res.json({ reports, bank, business_lines: BRAIN_BUSINESS_LINES, topics: Object.keys(BRAIN_TOPICS), can_review: req.authUser.role === "admin" });
  }));
  router.post("/reports", upload.single("file"), run(async (req, res) => {
    let source = {};
    if (req.body.report_version_id) {
      const report = await resolveReportVersion?.(String(req.body.report_version_id), req.authUser);
      if (!report) throw brainError("Final report version not found or access was removed.", 404);
      if (report.status !== "Final" || report.issue_state !== "Final" || report.human_approval_required !== false || !report.approved_by || !report.approved_date) throw brainError("Approve and sign off this report version before submitting its final file to the Brain.", 409);
      assertReportCanBeIssued(report);
      source = { source_report_version_id: report.id, source_claim_id: report.claim_id };
      req.body = { ...req.body, report_status: "final", claim_case_id: report.claim_number || report.claim_id, report_title: `${report.template_name || "Final report"} · Version ${report.version_number}`, business_line: report.business_line, approved_by: report.approved_by, approval_date: String(report.approved_date).slice(0, 10) };
    }
    const metadata = { ...finalReportSubmission(req.body), ...source };
    if (!req.file || ![".pdf", ".docx", ".txt"].includes(path.extname(req.file.originalname).toLowerCase())) throw brainError("Upload a PDF, DOCX, or text version of the approved final report.");
    const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    // Scope deduplication to the uploader: a duplicate must not expose another employee's source.
    const id = crypto.createHash("sha256").update(JSON.stringify([req.authUser.id, metadata.claim_case_id, metadata.business_line, metadata.topic, fileHash])).digest("hex");
    const record = { ...metadata, id, file_hash: fileHash, file_name: path.basename(req.file.originalname).slice(0, 250), mime_type: req.file.mimetype,
      size: req.file.size, status: "uploaded", revision: 0, created_at: new Date().toISOString(), uploaded_by: req.authUser.id, uploader_name: req.authUser.full_name || req.authUser.email || req.authUser.id };
    res.json(await store.insert(record, req.file.buffer, req.authUser));
  }));
  router.get("/reports/:id/file", run(async (req, res) => {
    const record = await required(req);
    res.type("application/octet-stream").attachment(record.file_name).send(record.buffer);
  }));
  router.post("/reports/:id/verify-approval", requireAdmin, run(async (req, res) => {
    if (req.body.confirmed !== true || typeof req.body.verification_note !== "string" || req.body.verification_note.trim().length < 10 || req.body.verification_note.length > 1000) throw brainError("Confirm the final report's existing human approval and record how you verified it.");
    res.json(await review(req, (record) => {
      if (record.approval_status !== "submitted" || record.report_status !== "final" || !record.claim_case_id || !record.approved_by || !record.approval_date) throw brainError("Only a complete final-report submission awaiting verification can be verified.", 409);
      return { approval_status: "verified", verified_by: req.authUser.id, verified_at: new Date().toISOString(), verification_note: req.body.verification_note.trim() };
    }));
  }));
  router.post("/reports/:id/reject", requireAdmin, run(async (req, res) => {
    if (typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 1000) throw brainError("Enter the reason this report is ineligible for the knowledge base.");
    res.json(await review(req, () => ({ approval_status: "rejected", status: "rejected", knowledge_manifest: null, rejected_by: req.authUser.id, rejected_at: new Date().toISOString(), rejection_reason: req.body.reason.trim() })));
  }));
  router.post("/reports/:id/learn", requireAdmin, run(async (req, res) => {
    const record = await required(req);
    if (record.approval_status !== "verified" || record.report_status !== "final") throw brainError("Only verified, human-approved final reports can be digested.", 409);
    if (record.style_notes?.length && record.learned_at) return res.json({ ...brainMetadata(record), reused: true });
    const attempt = crypto.randomUUID();
    await store.mutate(record.id, req.authUser, (current) => {
      if (current.approval_status !== "verified" || !["uploaded", "failed"].includes(current.status)) throw brainError("The report is already being digested or is no longer eligible. Refresh the library.", 409);
      return { status: "learning", learning_started_at: new Date().toISOString(), learning_attempt: attempt };
    });
    try {
      let text = record.extracted_text;
      if (!text) {
        const evidence = await extract({ buffer: record.buffer, originalname: record.file_name, mimetype: record.mime_type, size: record.size });
        if (evidence.extraction_status !== "extracted" || !evidence.pages?.length || evidence.pages.some((page) => !String(page.text || "").trim())) throw brainError("The complete report must be readable as text. Upload an OCR-readable final PDF, DOCX, or text version.");
        text = evidenceText(evidence);
        if (text.length < 50 || text.length > 150_000) throw brainError("The complete report must contain 50 to 150,000 readable characters. No partial report was digested.");
        await store.mutate(record.id, req.authUser, (current) => {
          if (current.learning_attempt !== attempt) throw brainError("This digestion attempt was reset.", 409);
          return { extracted_text: text };
        });
      }
      const learned = await learner(text);
      res.json(await store.mutate(record.id, req.authUser, (current) => {
        if (current.learning_attempt !== attempt || current.status !== "learning") throw brainError("This digestion attempt was reset. Refresh the saved report.", 409);
        return { ...learned, status: "pending", error: null, learned_at: new Date().toISOString(), learning_attempt: null };
      }));
    } catch (error) {
      await store.mutate(record.id, req.authUser, (current) => current.learning_attempt === attempt ? { status: "failed", error: error.message, learning_attempt: null } : {});
      throw error;
    }
  }));
  router.post("/reports/:id/activate", requireAdmin, run(async (req, res) => {
    res.json(await review(req, (record) => {
      if (!["pending", "removed", "active"].includes(record.status)) throw brainError("Digest and review this final report before activation.", 409);
      const manifest = approvedBrainManifest(record, req.body.style_notes, req.body.methodology_only === true);
      return { status: "active", knowledge_manifest: manifest, activated_by: req.authUser.id, activated_at: new Date().toISOString() };
    }));
  }));
  router.post("/reports/:id/remove-knowledge", requireAdmin, run(async (req, res) => {
    res.json(await review(req, (record) => {
      if (record.status !== "active") throw brainError("This report has no active knowledge to remove.", 409);
      return { status: "removed", knowledge_manifest: null, removed_by: req.authUser.id, removed_at: new Date().toISOString() };
    }));
  }));
  router.post("/reports/:id/reset", requireAdmin, run(async (req, res) => {
    await required(req);
    res.json(await store.mutate(req.params.id, req.authUser, (record) => {
      if (record.status !== "learning" || Date.now() - Date.parse(record.learning_started_at) < 5 * 60_000) throw brainError("Only digestion interrupted for at least five minutes may be reset.", 409);
      return { status: "failed", learning_attempt: null, error: "Interrupted attempt reset. Provider billing may be uncertain; retrying can incur another charge." };
    }));
  }));
  router.delete("/reports/:id", run(async (req, res) => {
    await required(req);
    res.status(405).json({ error: "Original reports are retained. An administrator can remove their methodology from the knowledge base instead." });
  }));
  router.use((error, _req, res, _next) => res.status(error instanceof multer.MulterError ? 400 : 500).json({ error: error.message }));
  return router;
}
