import test from "node:test";
import assert from "node:assert/strict";
import { requestAnthropicResponse } from "../ai/providers/anthropicTransport.mjs";

const options = { endpoint: "https://example.invalid", headers: {}, body: "{}", timeoutMs: 2000, idleTimeoutMs: 1000 };

test("stream progress arrives before completion and contains no model content", async () => {
  let stream;
  const events = [];
  const payload = new TextEncoder().encode('data: {"private":"réponse and internal thinking"}\n\n');
  let notify;
  const firstData = new Promise((resolve) => { notify = resolve; });
  const request = requestAnthropicResponse({ ...options,
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })),
    onProgress: (progress) => { events.push(progress); if (progress.stage === "receiving") notify(); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  // Split UTF-8 inside the accented character to exercise streaming decoding.
  const split = payload.indexOf(0xc3) + 1;
  stream.enqueue(payload.slice(0, split));
  await firstData;
  assert.equal(events.at(-1).received_bytes, split);
  assert.doesNotMatch(JSON.stringify(events), /private|thinking|réponse/);
  stream.enqueue(payload.slice(split));
  stream.close();
  const result = await request;
  assert.equal(result.responseText, new TextDecoder().decode(payload));
  assert.equal(events.at(-1).received_bytes, payload.length);
});

test("a silent response stream is cancelled by the idle deadline", async () => {
  let cancelled = false, signal;
  await assert.rejects(requestAnthropicResponse({ ...options, idleTimeoutMs: 25,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    },
  }), (error) => error.name === "TimeoutError" && error.transportPhase === "reading_response_stream");
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("connection setup cannot wait forever even if a transport ignores abort", async () => {
  await assert.rejects(requestAnthropicResponse({ ...options, idleTimeoutMs: 25,
    fetchImpl: () => new Promise(() => {}),
  }), (error) => error.name === "TimeoutError" && error.transportPhase === "awaiting_response_headers");
});

test("continued stream activity does not extend the total request deadline", async () => {
  let timer;
  const request = requestAnthropicResponse({ ...options, timeoutMs: 60,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: {"type":"ping"}\n\n')), 5); },
      cancel() { clearInterval(timer); },
    })),
  });
  try { await assert.rejects(request, /timed out before completing/); }
  finally { clearInterval(timer); }
});
