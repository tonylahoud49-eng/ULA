// Consume transport activity incrementally. Never publish model text or thinking
// as progress: only a fully validated response may become a saved review.
export async function requestAnthropicResponse({ fetchImpl, endpoint, headers, body, timeoutMs, idleTimeoutMs, onProgress, onHeaders }) {
  const controller = new AbortController();
  let idleTimer, reader, response, receivedBytes = 0;
  let phase = "awaiting_response_headers";
  const fail = (message) => controller.abort(Object.assign(new Error(message), { name: "TimeoutError" }));
  const totalTimer = setTimeout(() => fail("The AI request timed out before completing its response."), timeoutMs);
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fail("The AI connection timed out with no response activity."), idleTimeoutMs);
  };
  // Race even injected transports against the deadline. Native fetch is also
  // aborted so a failed request cannot continue streaming in the background.
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    rejectAbort(controller.signal.reason);
    if (reader) void reader.cancel(controller.signal.reason).catch(() => {});
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const wait = (promise) => Promise.race([promise, aborted]);
  try {
    touch();
    onProgress?.({ stage: "connecting", received_bytes: 0 });
    response = await wait(fetchImpl(endpoint, { method: "POST", headers, body, signal: controller.signal }));
    phase = "reading_response_stream";
    onHeaders?.(response);
    touch();
    onProgress?.({ stage: "waiting", received_bytes: 0 });
    let responseText = "";
    if (response.body?.getReader) {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await wait(reader.read());
        controller.signal.throwIfAborted();
        if (done) break;
        if (value.byteLength) {
          receivedBytes += value.byteLength;
          touch();
          responseText += decoder.decode(value, { stream: true });
          onProgress?.({ stage: "receiving", received_bytes: receivedBytes });
        }
      }
      responseText += decoder.decode();
    } else {
      responseText = await wait(response.text());
    }
    return { response, responseText };
  } catch (error) {
    // Preserve diagnostics without attaching request headers or evidence.
    error.transportPhase = phase;
    error.httpStatus = response?.status || null;
    error.providerRequestId = response?.headers?.get?.("request-id") || null;
    throw error;
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    controller.signal.removeEventListener("abort", onAbort);
    reader?.releaseLock();
  }
}
