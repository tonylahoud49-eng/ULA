import test from "node:test";
import assert from "node:assert/strict";
import { analysisProgressView } from "../../src/lib/analysisProgress.js";

test("queued and inventory states communicate unknown totals without 0/0 or a completion estimate", () => {
  const job = { state: "queued", phase: "extracting", created_at: "2026-10-08T08:00:00Z", queue: { position: 2, active_jobs: 2, concurrency: 2 } };
  const view = analysisProgressView(job, Date.parse("2026-10-08T08:20:00Z"));
  assert.equal(view.title, "Waiting to start");
  assert.equal(view.percent, null);
  assert.equal(view.elapsed, "Waiting: 20m 00s");
  assert.match(view.queueMessage, /Queue position 2.*2 analyses are running/);
  assert.doesNotMatch(view.count, /0 of 0/);
  const inventory = analysisProgressView({ ...job, state: "running" });
  assert.match(inventory.count, /Page totals will appear/);
  assert.equal(inventory.percent, null);
});

test("saved extraction is separate from review; connection activity and time never advance reviewed pages", () => {
  const job = { state: "running", phase: "reviewing", total_pages: 71, extracted_pages: 71, reviewed_pages: 0, total_batches: 2, completed_batches: 0, created_at: "2026-10-08T08:00:00Z", request_progress: { stage: "receiving", received_bytes: 10000 } };
  const view = analysisProgressView(job, Date.parse("2026-10-08T08:20:00Z"));
  assert.equal(view.percent, 0);
  assert.match(view.prepared, /71 of 71/);
  assert.match(view.count, /0 of 71 PDF pages reviewed and saved/);
  assert.equal(analysisProgressView(job, Date.parse("2026-10-08T09:00:00Z")).percent, 0);
  assert.equal(analysisProgressView({ ...job, reviewed_pages: 60, completed_batches: 1 }).percent, 85);
  const synthesis = analysisProgressView({ ...job, phase: "synthesizing", reviewed_pages: 71 });
  assert.equal(synthesis.title, "Analysis in progress");
  assert.equal(synthesis.percent, 100, "the bar describes saved evidence review, not final reconciliation");
});
