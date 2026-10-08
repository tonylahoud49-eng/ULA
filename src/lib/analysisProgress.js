export const analysisDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor((Number.isFinite(milliseconds) ? milliseconds : 0) / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};

export function analysisProgressView(job, clock = Date.now()) {
  if (!job) return { title: "Saved analysis", count: "Discuss the evidence behind this analysis.", percent: null, prepared: null, elapsed: null, queueMessage: null };
  const queued = job.state === "queued";
  const stopped = ["failed", "interrupted"].includes(job.state);
  const total = job.total_pages || 0;
  const batches = job.total_batches || 0;
  const count = queued ? "Your analysis is waiting to start."
    : total ? `${job.reviewed_pages || 0} of ${total} PDF pages reviewed and saved`
      : batches ? `${job.completed_batches || 0} of ${batches} review batches saved`
        : "Checking documents. Page totals will appear when the inventory is ready.";
  const timestamp = Date.parse(queued ? job.queued_at || job.created_at : job.created_at);
  const activeJobs = job.queue?.active_jobs || 0;
  const queueMessage = queued && job.queue ? job.queue.position
    ? `Queue position ${job.queue.position}. ${activeJobs} ${activeJobs === 1 ? "analysis is" : "analyses are"} running. Up to ${job.queue.concurrency} can run at once.`
    : "An analysis slot is being assigned."
    : null;
  return {
    title: queued ? "Waiting to start" : stopped ? "Analysis needs attention" : job.state === "running" ? "Analysis in progress" : "Saved analysis",
    count,
    percent: queued ? null : total ? Math.min(100, Math.round((job.reviewed_pages || 0) / total * 100))
      : batches ? Math.min(100, Math.round((job.completed_batches || 0) / batches * 100)) : null,
    prepared: total ? `Evidence prepared and saved: ${Math.min(total, job.extracted_pages || 0)} of ${total} PDF pages.` : null,
    elapsed: Number.isFinite(timestamp) ? `${queued ? "Waiting" : "Total elapsed"}: ${analysisDuration(clock - timestamp)}` : null,
    queueMessage,
  };
}
