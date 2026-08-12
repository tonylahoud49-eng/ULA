import test from "node:test";
import assert from "node:assert/strict";

test("HTTP API exposes health and a truthful unavailable analysis state without credentials", async () => {
  process.env.AI_PROVIDER = "openai";
  delete process.env.OPENAI_API_KEY;
  const { default: app } = await import("../index.mjs");
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  try {
    const address = listener.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const status = await fetch(`${baseUrl}/api/ai/status`).then((response) => response.json());
    assert.equal(status.configured, false);
    assert.equal(status.provider, "openai");

    const response = await fetch(`${baseUrl}/api/ai/analyze`, { method: "POST" });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "ai-provider-unavailable");
    assert.match(body.error, /AI analysis unavailable/i);
  } finally {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
});
