import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousAdjusterOrchestrator } from "../ai/agent/orchestrator.mjs";

test("AutonomousAdjusterOrchestrator executes all 5 phases in sequence", async () => {
  const orchestrator = new AutonomousAdjusterOrchestrator({
    claim: { id: "test-orch-01", title: "Marine Reefer Test", business_line: "Marine Cargo (Reefer/GFS)", currency: "USD" },
    files: [
      { originalname: "Invoice.pdf", buffer: Buffer.from("Invoice details USD 10000"), mimetype: "application/pdf" }
    ],
    mode: "free"
  });

  const phasesEmitted = [];
  orchestrator.on("phase_changed", (p) => phasesEmitted.push(p.name));

  const report = await orchestrator.execute();
  assert.ok(phasesEmitted.includes("perception_indexing"));
  assert.ok(phasesEmitted.includes("reconciliation_triage"));
  assert.ok(phasesEmitted.includes("coverage_cause_audit"));
  assert.ok(phasesEmitted.includes("quantum_calculation"));
  assert.ok(phasesEmitted.includes("report_assembly"));
  assert.equal(report.passed_quality_gate, true);
});
