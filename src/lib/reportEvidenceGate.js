const unavailableStates = new Set(["failed", "unavailable", "unsupported"]);

export function unreviewedAttachments(evidence = []) {
  return evidence.filter((item) => unavailableStates.has(item.extraction_status));
}

export function attachmentReviewMessage(item) {
  return `Obtain a readable copy of ${item.document_name || "the excluded attachment"} and review its contents against the draft findings and adjustment before final issue.`;
}

export function evidenceForDraft(analysis, documents) {
  const evidence = analysis?.evidence_snapshot;
  const fail = (message) => {
    const error = new Error(message);
    error.status = 422;
    error.code = "incomplete-analysis-evidence";
    throw error;
  };
  if (analysis?.status !== "completed" || !Array.isArray(evidence) || !documents.length) {
    fail("A saved completed analysis is required before generating a draft report.");
  }
  let reviewedCount = 0;
  const selected = documents.map((document) => {
    const item = evidence.find((entry) => entry.document_id === document.id);
    if (!item || !Array.isArray(item.pages)) {
      fail(`The saved analysis does not include ${document.file_name || "an uploaded document"}. Review the changed evidence set before drafting.`);
    }
    const isPdf = item.mime_type === "application/pdf" || /\.pdf$/i.test(item.document_name || document.file_name);
    if (item.extraction_status === "unsupported" && !isPdf) return item;
    if (unavailableStates.has(item.extraction_status)
      || !(item.pages.some((page) => String(page.text || "").trim())
        || ["vision-only", "vision-required"].includes(item.extraction_status))) {
      fail(`The saved analysis lacks usable evidence for ${document.file_name || item.document_name}. Resolve its extraction or page-coverage failure before drafting.`);
    }
    reviewedCount += 1;
    return item;
  });
  if (!reviewedCount) fail("No reviewed evidence is available for a provisional draft.");
  return selected;
}

export function assertReportCanBeIssued(report) {
  if (![report?.issue_state, report?.status].some((state) => /^(final|approved|issued)$/i.test(String(state || "")))) return;
  const record = report.normalized_claim_record;
  const blockers = [...new Set([
    ...(record?.report_quality?.issue_blockers || []),
    ...unreviewedAttachments(record?.evidence).map(attachmentReviewMessage),
  ])];
  if (blockers.length) {
    const error = new Error(`Final report quality gate: ${blockers.join("; ")}`);
    error.status = 422;
    error.code = "report-final-issue-blocked";
    throw error;
  }
}
