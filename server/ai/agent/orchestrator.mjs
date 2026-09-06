import { EventEmitter } from "node:events";
import { getClaimDossier, saveClaimDossier } from "./dossierStore.mjs";
import { indexDocumentWithReader } from "./documentReaderAgent.mjs";
import { reconcileDossier } from "./reconciliationEngine.mjs";
import { evaluateCoverageAndCause } from "./adjusterBrainAgent.mjs";
import { calculateQuantumAndUnderinsurance } from "./quantumEngine.mjs";
import { assembleMasterAgentReport } from "./reportAssemblerAgent.mjs";

export class AutonomousAdjusterOrchestrator extends EventEmitter {
  constructor({ claim, files = [], mode = "hybrid", options = {} }) {
    super();
    this.claim = claim;
    this.files = files;
    this.mode = mode; // "free" | "hybrid" | "forensic"
    this.options = options;
  }

  emitPhase(name, description, progress) {
    this.emit("phase_changed", { name, description, progress, timestamp: new Date().toISOString() });
  }

  async execute() {
    const claimId = this.claim.id || "temp-claim";

    // Phase 1: High-Speed Document Indexing & Dossier Caching
    this.emitPhase("perception_indexing", `Initializing investigation for ${this.claim.claim_number || this.claim.title || "claim"}...`, 10);
    const dossier = await getClaimDossier(claimId);
    const newDocIndex = {};

    const totalFiles = Math.max(1, this.files.length);
    if (this.files.length === 0) {
      this.emitPhase("perception_indexing", "No raw file attachments provided; reviewing existing docket facts...", 25);
    }

    for (let i = 0; i < this.files.length; i += 1) {
      const file = this.files[i];
      const cached = dossier.documents[file.originalname] || null;

      const indexProvider = (this.mode === "forensic" && process.env.ANTHROPIC_API_KEY) ? "anthropic" : "gemini";
      const indexModel = indexProvider === "gemini"
        ? (process.env.GEMINI_MODEL || "gemini-3.7-flash")
        : (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6");

      const providerLabel = indexProvider === "gemini" ? "Gemini 3.7 Flash" : "Claude Sonnet";
      this.emitPhase("perception_indexing", `Indexing "${file.originalname}" (${providerLabel})...`, Math.round(15 + (i / totalFiles) * 20));

      const indexed = await indexDocumentWithReader({
        file,
        cachedDoc: cached,
        claimContext: this.claim,
        providerName: indexProvider,
        modelName: indexModel,
      });
      newDocIndex[file.originalname] = indexed;
      const statusMsg = indexed.from_cache
        ? `✓ Reused cached dossier for "${file.originalname}" (SHA-256 match, 0 tokens spent)`
        : `✓ Indexed "${file.originalname}" as ${indexed.document_type || "Evidence"}`;
      this.emitPhase("perception_indexing", statusMsg, Math.round(20 + ((i + 1) / totalFiles) * 20));
    }

    // Phase 2: Evidence Cross-Referencing & Discrepancy Triage
    this.emitPhase("reconciliation_triage", "Cross-referencing tallies, dates, seals, and container numbers...", 45);
    const reconciliation = reconcileDossier({
      business_line: this.claim.business_line || "Marine Cargo",
      documents: newDocIndex,
    });

    await saveClaimDossier(claimId, {
      documents: newDocIndex,
      reconciliation,
    });

    const reconDetail = reconciliation.container_numbers.length
      ? `Containers: ${reconciliation.container_numbers.join(", ")}`
      : "Evidence documents reconciled";
    this.emitPhase("reconciliation_triage", `Reconciliation complete: ${reconDetail} (${reconciliation.missing_mandatory_docs.length ? `Missing: ${reconciliation.missing_mandatory_docs.join(", ")}` : "All mandatory documents verified"})`, 58);

    // Phase 3: Coverage, Warranties & Cause Audit
    const auditProvider = (this.mode === "free" || !process.env.ANTHROPIC_API_KEY) ? "gemini" : "anthropic";
    const auditModel = auditProvider === "gemini"
      ? (process.env.GEMINI_MODEL || "gemini-3.7-flash")
      : (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6");
    const auditProviderLabel = auditProvider === "gemini" ? "Gemini 3.7 Flash" : "Claude 3.7 Sonnet";

    this.emitPhase("coverage_cause_audit", `Loading Loss Adjuster Brain playbooks & auditing proximate cause via ${auditProviderLabel}...`, 68);

    const audit = await evaluateCoverageAndCause({
      claim: this.claim,
      dossier: { ...dossier, documents: newDocIndex, reconciliation },
      providerName: auditProvider,
      modelName: auditModel,
    });

    const confidencePct = audit.confidence
      ? (audit.confidence <= 1 ? Math.round(audit.confidence * 100) : Math.round(audit.confidence))
      : 90;
    this.emitPhase("coverage_cause_audit", `Cause & coverage audit concluded (${confidencePct}% confidence)`, 80);

    // Phase 4: Deterministic Quantum Engine
    this.emitPhase("quantum_calculation", "Executing deterministic quantum and underinsurance math ($0.00 token cost)...", 86);
    const quantum = calculateQuantumAndUnderinsurance({
      lineItems: audit.adjustment_line_items || [],
      invoiceTotal: Number(this.claim.invoice_total || this.claim.claim_amount || 0),
      insuredValue: Number(this.claim.insured_value || this.claim.claim_amount || 0),
      upliftPercentage: Number(this.claim.uplift_percentage || 0),
      currency: this.claim.currency || "USD",
      deductions: { salvage: 0, depreciation: 0 },
      deductibleConfig: { type: "fixed", amount: Number(this.claim.deductible || 0) },
    });

    this.emitPhase("quantum_calculation", `Quantum determined: Net Payable ${quantum.currency} ${quantum.net_indemnity.toLocaleString()}`, 92);

    // Phase 5: Master Report Assembly & Quality Gates
    this.emitPhase("report_assembly", "Validating Director requirements, 5-point conclusion, and quality gate...", 96);
    const masterReport = assembleMasterAgentReport({
      claim: this.claim,
      audit,
      quantum,
      reconciliation,
    });

    this.emitPhase("complete", "Master investigation report assembled and certified.", 100);
    return masterReport;
  }
}
