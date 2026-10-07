export async function brainRequest(url, options = {}) {
  const response = await fetch(`/api/ai/brain${url}`, options);
  let body;
  try { body = await response.json(); }
  catch { throw new Error("The Brain service could not be reached. Refresh and retry; saved reports are retained."); }
  if (!response.ok) throw new Error(body.error || "The approved report library could not be loaded.");
  return body;
}
