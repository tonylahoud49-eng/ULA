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
    this.emitPhase("perception_indexing", "Indexing evidence documents with high-speed reader...", 20);
    const dossier = await getClaimDossier(claimId);
    const newDocIndex = {};

    for (const file of this.files) {
      const cached = dossier.documents[file.originalname] || null;
      const indexed = await indexDocumentWithReader({
        file,
        cachedDoc: cached,
        claimContext: this.claim,
        providerName: this.mode === "forensic" ? "anthropic" : "gemini",
      });
      newDocIndex[file.originalname] = indexed;
    }

    // Phase 2: Evidence Cross-Referencing & Discrepancy Triage
    this.emitPhase("reconciliation_triage", "Cross-referencing tallies, dates, and container numbers...", 45);
    const reconciliation = reconcileDossier({
      business_line: this.claim.business_line || "Marine Cargo",
      documents: newDocIndex,
    });

    await saveClaimDossier(claimId, {
      documents: newDocIndex,
      reconciliation,
    });

    // Phase 3: Coverage, Warranties & Cause Audit
    this.emitPhase("coverage_cause_audit", "Auditing proximate cause, policy warranties, and exclusions...", 70);
    const audit = await evaluateCoverageAndCause({
      claim: this.claim,
      dossier: { ...dossier, documents: newDocIndex, reconciliation },
      providerName: this.mode === "free" ? "gemini" : "anthropic",
    });

    // Phase 4: Deterministic Quantum Engine
    this.emitPhase("quantum_calculation", "Executing deterministic quantum and underinsurance math...", 85);
    const quantum = calculateQuantumAndUnderinsurance({
      lineItems: audit.adjustment_line_items || [],
      invoiceTotal: Number(this.claim.invoice_total || this.claim.claim_amount || 0),
      insuredValue: Number(this.claim.insured_value || this.claim.claim_amount || 0),
      upliftPercentage: Number(this.claim.uplift_percentage || 0),
      currency: this.claim.currency || "USD",
      deductions: { salvage: 0, depreciation: 0 },
      deductibleConfig: { type: "fixed", amount: Number(this.claim.deductible || 0) },
    });

    // Phase 5: Master Report Assembly & Quality Gates
    this.emitPhase("report_assembly", "Verifying Director requirements and assembling master report...", 100);
    const masterReport = assembleMasterAgentReport({
      claim: this.claim,
      audit,
      quantum,
      reconciliation,
    });

    return masterReport;
  }
}
