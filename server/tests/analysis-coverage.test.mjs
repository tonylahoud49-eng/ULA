import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisCoveragePlan, enforceAnalysisCoverage } from "../ai/analysisCoverage.mjs";

const evidence = [{
  document_id: "doc-1",
  document_name: "claim-file.pdf",
  native_pdf: true,
  pages: [
    { page: 1, text: "Marine policy deductible and insured value." },
    { page: 2, text: "Survey records cracked cargo after impact during container delivery. Invoice EUR 5284.18." },
  ],
}];

test("coverage plan makes evidence-driven reasoning domains explicit", () => {
  const plan = buildAnalysisCoveragePlan(evidence);
  assert.match(plan.prompt, /CURRENT-CLAIM PAGE INVENTORY/);
  assert.match(plan.prompt, /pages 1–2/);
  assert.deepEqual(plan.requiredDomains.map((item) => item.domain), [
    "policy_application",
    "chronology_custody",
    "condition_extent",
    "proximate_cause",
    "quantum_mitigation",
  ]);
});

test("coverage enforcement flags omitted relevant domains without fabricating a finding", () => {
  const result = enforceAnalysisCoverage({
    evidence_findings: [{ analysis_domain: "condition_extent", finding: "Cited condition finding.", sources: [] }],
    warnings: [],
    human_review_required: [],
  }, evidence);
  assert.equal(result.evidence_findings.length, 1);
  assert.ok(result.warnings.some((item) => item.includes("policy_application")));
  assert.ok(result.human_review_required.some((item) => item.includes("quantum_mitigation")));
});
