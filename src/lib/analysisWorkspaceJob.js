export function analysisWorkspaceJobPath(claimId, analysis, activeJobId) {
  const jobId = activeJobId || analysis?.job_id;
  if (jobId) return `/api/ai/jobs/${encodeURIComponent(jobId)}`;
  if (!claimId || analysis) return null;
  return `/api/ai/jobs?claim_id=${encodeURIComponent(claimId)}`;
}
