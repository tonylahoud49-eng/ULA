const activeAnalyses = new Map();

export function analysisSingleFlightKey({ claim, documents = [], provider, model }) {
  return JSON.stringify({
    claim_id: claim?.id || null,
    provider: provider || null,
    model: model || null,
    documents: documents.map((document) => [
      document.id || null,
      document.storage_key || document.file_url || null,
      document.updated_date || document.updated_at || null,
    ]),
  });
}

export function runAnalysisSingleFlight(key, operation) {
  const existing = activeAnalyses.get(key);
  if (existing) return existing;

  const execution = Promise.resolve().then(operation);
  activeAnalyses.set(key, execution);
  execution.finally(() => {
    if (activeAnalyses.get(key) === execution) activeAnalyses.delete(key);
  }).catch(() => {
    // Observe the cleanup branch; the caller still receives the original rejection.
  });
  return execution;
}
