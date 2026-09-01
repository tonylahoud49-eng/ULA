import test from "node:test";
import assert from "node:assert/strict";
import {
  anthropicMessageFixture,
  multiDocumentEvidenceFixture,
} from "./fixtures/anthropicResponses.mjs";

test("HTTP API exposes health and a truthful unavailable analysis state without credentials", async () => {
  const originalEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROTIC_API_KEY: process.env.ANTHROTIC_API_KEY,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_SENDER_EMAIL: process.env.MICROSOFT_SENDER_EMAIL,
    LEAVE_ADMIN_EMAIL: process.env.LEAVE_ADMIN_EMAIL,
    APP_BASE_URL: process.env.APP_BASE_URL,
  };
  Object.assign(process.env, {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    GEMINI_API_KEY: "",
    GEMINI_API_KEY_2: "",
    ANTHROPIC_API_KEY: "",
    ANTHROTIC_API_KEY: "",
    MICROSOFT_TENANT_ID: "",
    MICROSOFT_CLIENT_ID: "",
    MICROSOFT_CLIENT_SECRET: "",
    MICROSOFT_SENDER_EMAIL: "",
    EMAILJS_SERVICE_ID: "",
    EMAILJS_TEMPLATE_ID: "",
    EMAILJS_PUBLIC_KEY: "",
    EMAILJS_PRIVATE_KEY: "",
    LEAVE_ADMIN_EMAIL: "",
    APP_BASE_URL: "",
  });
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

    const leaveEmailStatus = await fetch(`${baseUrl}/api/leave/email/status`).then((response) => response.json());
    assert.equal(leaveEmailStatus.configured, false);
    assert.ok(leaveEmailStatus.missing.includes("MICROSOFT_CLIENT_SECRET"));

    const response = await fetch(`${baseUrl}/api/ai/analyze`, { method: "POST" });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, "ai-provider-unavailable");
    assert.match(body.error, /AI analysis unavailable/i);
  } finally {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("regression: closed debug output does not turn a valid mocked Claude analysis into HTTP 500", async () => {
  const originalEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ANTHROTIC_API_KEY: process.env.ANTHROTIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AI_DEBUG_LOGGING: process.env.AI_DEBUG_LOGGING,
    NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT,
  };
  Object.assign(process.env, {
    AI_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "mock-server-only-key",
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    ANTHROTIC_API_KEY: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    GEMINI_API_KEY: "",
    AI_DEBUG_LOGGING: "true",
    NODE_TEST_CONTEXT: "",
  });

  const realFetch = globalThis.fetch;
  const realConsoleInfo = console.info;
  let anthropicRequest;
  let mockedAnthropicCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://api.anthropic.com/v1/messages") {
      throw new Error(`Unexpected non-mocked network request: ${url}`);
    }
    mockedAnthropicCalls += 1;
    anthropicRequest = options;
    return new Response(JSON.stringify(anthropicMessageFixture()), {
      status: 200,
      headers: { "request-id": "req_mock_pipeline" },
    });
  };
  // Reproduces the latest HTTP 500 failure mode: a closed watcher/output pipe
  // used to let a development debug log abort an otherwise valid analysis.
  console.info = () => {
    const error = new Error("write EPIPE");
    error.code = "EPIPE";
    throw error;
  };

  const { default: app } = await import("../index.mjs");
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  try {
    const address = listener.address();
    const manifest = multiDocumentEvidenceFixture.map((item, index) => ({
        index,
        id: item.document_id,
        file_name: item.document_name,
        file_mime_type: item.mime_type,
        file_type: "Other",
        category: "Other",
    }));
    const buildForm = (preflightToken) => {
      const form = new FormData();
      multiDocumentEvidenceFixture.forEach((item) => {
        form.append("files", new Blob([item.pages[0].text], { type: item.mime_type }), item.document_name);
      });
      form.append("claim", JSON.stringify({ id: "mock-pipeline-claim" }));
      form.append("manifest", JSON.stringify(manifest));
      form.append("provider", "anthropic");
      form.append("model", "claude-sonnet-4-6");
      if (preflightToken) form.append("preflight_token", preflightToken);
      return form;
    };

    const preflightResponse = await realFetch(`http://127.0.0.1:${address.port}/api/ai/preflight`, {
      method: "POST",
      body: buildForm(),
    });
    const preflightBody = await preflightResponse.json();
    assert.equal(preflightResponse.status, 200);
    assert.equal(preflightBody.connectivity.checked, false);
    assert.equal(preflightBody.connectivity.http_status, null);
    assert.equal(preflightBody.stats.document_count, 3);
    assert.equal(mockedAnthropicCalls, 0);

    const simultaneousPreflightResponse = await realFetch(`http://127.0.0.1:${address.port}/api/ai/preflight`, {
      method: "POST",
      body: buildForm(),
    });
    const simultaneousPreflight = await simultaneousPreflightResponse.json();
    assert.equal(simultaneousPreflightResponse.status, 200);
    assert.equal(simultaneousPreflight.preflight_token, preflightBody.preflight_token);
    assert.equal(mockedAnthropicCalls, 0);

    const response = await realFetch(`http://127.0.0.1:${address.port}/api/ai/analyze`, {
      method: "POST",
      body: buildForm(preflightBody.preflight_token),
    });
    const body = await response.json();
    const providerBody = JSON.parse(anthropicRequest.body);

    assert.equal(response.status, 200);
    assert.equal(mockedAnthropicCalls, 1);
    assert.equal(anthropicRequest.headers["x-api-key"], "mock-server-only-key");
    assert.equal(providerBody.model, "claude-sonnet-4-6");
    assert.equal(providerBody.max_tokens, 64_000);
    assert.equal(providerBody.stream, true);
    assert.equal(providerBody.tools, undefined);
    assert.match(providerBody.system, /Return only the structured payload/);
    assert.equal(body.evidence_register.length, 3);
    assert.equal(body.analysis.classification.confidence, 0.94);
    assert.equal(body.analysis.document_types.some((item) => item.document_type === "Policy"), true);
    assert.equal(body.analysis.document_types.some((item) => item.document_type === "Claim Form"), true);
    assert.equal(body.analysis.document_types.some((item) => item.document_type === "Supporting Evidence"), true);
    assert.equal(body.analysis.missing_documents.some((item) =>
      ["Policy", "Claim Form", "Supporting Evidence"].includes(item.document_type)), false);
    for (const item of multiDocumentEvidenceFixture) {
      assert.match(providerBody.messages[0].content[0].text, new RegExp(item.document_id));
      assert.match(providerBody.messages[0].content[0].text, new RegExp(item.pages[0].text.split("\n")[0]));
    }

    const consumedTokenResponse = await realFetch(`http://127.0.0.1:${address.port}/api/ai/analyze`, {
      method: "POST",
      body: buildForm(simultaneousPreflight.preflight_token),
    });
    const consumedTokenBody = await consumedTokenResponse.json();
    assert.equal(consumedTokenResponse.status, 412);
    assert.equal(consumedTokenBody.code, "anthropic-preflight-required");
    assert.equal(mockedAnthropicCalls, 1);

    const duplicatePreflightResponse = await realFetch(`http://127.0.0.1:${address.port}/api/ai/preflight`, {
      method: "POST",
      body: buildForm(),
    });
    const duplicatePreflight = await duplicatePreflightResponse.json();
    assert.equal(duplicatePreflightResponse.status, 200);
    assert.equal(duplicatePreflight.connectivity.checked, false);
    const duplicateResponse = await realFetch(`http://127.0.0.1:${address.port}/api/ai/analyze`, {
      method: "POST",
      body: buildForm(duplicatePreflight.preflight_token),
    });
    const duplicateBody = await duplicateResponse.json();
    assert.equal(duplicateResponse.status, 200);
    assert.equal(duplicateBody.duplicate_request_reused, true);
    assert.equal(mockedAnthropicCalls, 1);
  } finally {
    console.info = realConsoleInfo;
    globalThis.fetch = realFetch;
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
