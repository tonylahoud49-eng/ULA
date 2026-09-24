import assert from "node:assert/strict";
import test from "node:test";
import { savedAnalysisState, reviewedClaimValues } from "../../src/lib/reportWorkflow.js";

const document = { id: "policy", file_name: "policy.txt" };
const evidence = { document_id: "policy", extraction_status: "extracted", pages: [{ page: 1, text: "Policy schedule" }] };
const analysis = { status: "completed", evidence_snapshot: [evidence] };

test("reporting resumes the saved analysis without changing its evidence", () => {
  const state = savedAnalysisState({ ai_analysis: analysis }, [document]);
  assert.equal(state.canDraft, true);
  assert.equal(state.analysis, analysis);
  assert.equal(state.reason, "");
});

test("missing, failed or changed evidence cannot resume directly into drafting", () => {
  for (const claim of [{}, { ai_analysis: { ...analysis, status: "failed" } }]) {
    assert.equal(savedAnalysisState(claim, [document]).canDraft, false);
  }
  const changed = savedAnalysisState({ ai_analysis: analysis }, [document, { id: "new", file_name: "new.pdf" }]);
  assert.equal(changed.canDraft, false);
  assert.match(changed.reason, /new.pdf/);
  const failed = { ...analysis, evidence_snapshot: [{ ...evidence, extraction_status: "failed" }] };
  assert.equal(savedAnalysisState({ ai_analysis: failed }, [document]).canDraft, false);
});

test("provisional drafts retain the existing unsupported non-PDF rule", () => {
  const extra = { document_id: "legacy", document_name: "legacy.xls", extraction_status: "unsupported", pages: [] };
  const docs = [document, { id: "legacy", file_name: "legacy.xls" }];
  assert.equal(savedAnalysisState({ ai_analysis: { ...analysis, evidence_snapshot: [evidence, extra] } }, docs).canDraft, true);
  extra.document_name = "legacy.pdf";
  assert.equal(savedAnalysisState({ ai_analysis: { ...analysis, evidence_snapshot: [evidence, extra] } }, docs).canDraft, false);
});

test("review suggestions fill blanks, never overwrite entered values or zeroes", () => {
  const claim = { title: "Entered", business_line: "Unclassified", claim_amount: 0, insured: "", approved: false };
  const before = structuredClone(claim);
  const result = reviewedClaimValues(claim, { suggested_claim_data: { title: "AI", business_line: "Property", claim_amount: 999, insured: "Suggested", approved: true } });
  assert.deepEqual(claim, before);
  assert.deepEqual(result, { title: "Entered", business_line: "Property", claim_amount: 0, insured: "Suggested", approved: false });
});
