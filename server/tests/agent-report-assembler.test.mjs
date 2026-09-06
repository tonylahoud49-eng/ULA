import test from "node:test";
import assert from "node:assert/strict";
import { assembleMasterAgentReport } from "../ai/agent/reportAssemblerAgent.mjs";

test("assembleMasterAgentReport formats 5-point conclusion and enforces Director rules", () => {
  const report = assembleMasterAgentReport({
    claim: { id: "CLM-900", title: "Frozen Seafood Claim", currency: "USD", business_line: "Marine Cargo (Reefer/GFS)" },
    audit: {
      cause_of_loss: "The proximate cause of loss is mechanical failure of the reefer cooling unit.",
      cover_advice: "Cover advice: Subject to Institute Frozen Food Clauses.",
      liable_party_position: "Liable-party position: Recovery claim notified to carrier MSC.",
    },
    quantum: {
      currency: "USD",
      net_indemnity: 45000,
      adequacy_statement: "The invoice values are adequately insured and there is no underinsurance.",
    },
    reconciliation: {
      missing_mandatory_docs: [],
      container_numbers: ["MSKU9988771"]
    }
  });

  assert.equal(report.appointment_of_assessors, "To date, it is understood that the Assured had not appointed a loss assessor to act on their behalf.");
  assert.equal(report.conclusion_points.length, 5);
  assert.ok(report.conclusion_points[0].includes("USD 45,000.00 is considered fair & reasonable"));
  assert.ok(report.conclusion_points[1].includes("mechanical failure"));
  assert.ok(report.conclusion_points[4].includes("We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions."));
  assert.equal(report.passed_quality_gate, true);
});
