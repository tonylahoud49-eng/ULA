const protectedStreams = new WeakSet();

function protectDebugStream(stream) {
  if (!stream || typeof stream.on !== "function" || protectedStreams.has(stream)) return;
  protectedStreams.add(stream);
  // Debug output must never terminate an analysis request when its parent
  // terminal, watcher, or redirected output pipe has already closed.
  stream.on("error", () => undefined);
}

export function aiDebugEnabled() {
  return process.env.NODE_ENV !== "production"
    && process.env.AI_DEBUG_LOGGING !== "false"
    && !process.env.NODE_TEST_CONTEXT;
}

export function safeAiDebugLog(label, value) {
  if (!aiDebugEnabled()) return false;
  protectDebugStream(process.stdout);
  protectDebugStream(process.stderr);
  try {
    console.info(label, JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false;
  }
}

export const debugLogInternals = { protectDebugStream };
