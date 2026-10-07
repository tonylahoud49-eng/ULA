import test from "node:test";
import assert from "node:assert/strict";
import { analysisWorkspaceJobPath } from "../../src/lib/analysisWorkspaceJob.js";

test("selected saved analysis follows its own job rather than the claim's latest run", () => {
  assert.equal(analysisWorkspaceJobPath("claim", { job_id: "saved-job" }), "/api/ai/jobs/saved-job");
  assert.equal(analysisWorkspaceJobPath("claim", { response_id: "legacy-analysis" }), null);
});

test("an explicitly started run displays progress while the earlier saved analysis remains available", () => {
  assert.equal(analysisWorkspaceJobPath("claim", { job_id: "saved-job" }, "new-job"), "/api/ai/jobs/new-job");
  assert.equal(analysisWorkspaceJobPath("claim", null), "/api/ai/jobs?claim_id=claim");
  assert.equal(analysisWorkspaceJobPath(null, null), null);
});
