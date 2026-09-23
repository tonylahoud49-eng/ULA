import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { evidenceForDraft, assertReportCanBeIssued } from "../../src/lib/reportEvidenceGate.js";
import { createUnifiedReportDraft } from "../../src/lib/reportingEngine.js";
import { populateMasterReportDocx } from "../../src/lib/masterReportDocx.js";

const reviewed = { document_id: "policy", document_name: "policy.txt", extraction_status: "extracted", pages: [{ page: 1, text: "Policy number: POLICY-123. Insured: Example Ltd." }] };
const excluded = { document_id: "inventory", document_name: "inventory.xls", extraction_status: "unsupported", pages: [] };
const documents = [reviewed, excluded].map((item) => ({ id: item.document_id, file_name: item.document_name }));
const analysis = { status: "completed", evidence_snapshot: [reviewed, excluded] };

test("saved analysis permits a provisional draft with named gaps but blocks final issue and DOCX", async () => {
  const evidence = evidenceForDraft(analysis, documents);
  const draft = createUnifiedReportDraft({ claim: { id: "example", business_line: "Property" }, documents, evidence, versions: [], generatedBy: "Test Reviewer" });
  const record = draft.normalizedRecord;
  assert.match(draft.content, /inventory.xls \(not reviewed\)/);
  assert.ok(record.evidence_gaps.some((gap) => gap.category === "unreviewed_attachment" && gap.document_id === "inventory"));
  assert.ok(record.report_quality.issue_blockers.some((gap) => gap.includes("inventory.xls")));
  assert.doesNotThrow(() => assertReportCanBeIssued({ status: "Draft", normalized_claim_record: record }));
  for (const status of ["Final", "Approved", "Issued"]) {
    assert.throws(() => assertReportCanBeIssued({ status, normalized_claim_record: record }), /inventory.xls/);
  }
  const template = await fs.readFile(new URL("../../samples/templates/ULA-Master-Report.docx", import.meta.url));
  await populateMasterReportDocx(template, { report: { status: "Draft", normalized_claim_record: record } });
  await assert.rejects(populateMasterReportDocx(template, { report: { status: "Final", normalized_claim_record: record } }), /inventory.xls/);
});

test("provisional permission does not bypass missing analysis, new evidence, failed extraction or PDF coverage", () => {
  assert.throws(() => evidenceForDraft(null, documents), /saved completed analysis/);
  assert.throws(() => evidenceForDraft(analysis, [...documents, { id: "new", file_name: "new.pdf" }]), /new.pdf/);
  for (const item of [{ ...excluded, extraction_status: "failed" }, { ...excluded, document_name: "unread.pdf", mime_type: "application/pdf" }]) {
    assert.throws(() => evidenceForDraft({ ...analysis, evidence_snapshot: [reviewed, item] }, documents), /extraction or page-coverage/);
  }
  assert.throws(() => evidenceForDraft({ ...analysis, evidence_snapshot: [excluded] }, [documents[1]]), /No reviewed evidence/);
});
