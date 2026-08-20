import test from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicPreflightError,
  testAnthropicConnectivity,
  validateAnthropicClaimLocally,
} from "../ai/anthropicPreflight.mjs";

const configuredEnv = {
  AI_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "server-only-test-key",
  ANTHROPIC_MODEL: "claude-sonnet-4-6",
  ANTHROPIC_MAX_REQUEST_BYTES: "1048576",
  ANTHROPIC_MAX_ESTIMATED_INPUT_TOKENS: "10000",
};

test("Anthropic connectivity preflight uses one minimal document-free request", async () => {
  let request;
  const result = await testAnthropicConnectivity({
    env: configuredEnv,
    fetchImpl: async (_url, options) => {
      request = options;
      return new Response(JSON.stringify({
        id: "msg_preflight",
        type: "message",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "O" }],
      }), { status: 200, headers: { "request-id": "req_preflight" } });
    },
  });

  const body = JSON.parse(request.body);
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 1);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].content, "Reply OK.");
  assert.equal(body.output_config, undefined);
  assert.equal(request.headers["x-api-key"], "server-only-test-key");
  assert.equal(result.http_status, 200);
});

test("Anthropic local preflight extracts text and calculates safety statistics without a provider call", async () => {
  const text = "Policy POL-44 covers marine cargo. Claim amount USD 1,000.";
  const file = {
    originalname: "policy.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(text),
    buffer: Buffer.from(text),
  };
  const result = await validateAnthropicClaimLocally({
    claim: { id: "claim-preflight" },
    manifest: [{ id: "document-1", file_name: "policy.txt", category: "Policy" }],
    files: [file],
    env: configuredEnv,
  });

  assert.equal(result.stats.document_count, 1);
  assert.ok(result.stats.extracted_text_characters >= text.length);
  assert.ok(result.stats.estimated_input_tokens > 0);
  assert.ok(result.stats.estimated_request_bytes > 0);
  assert.equal(result.stats.selected_provider, "anthropic");
  assert.equal(result.stats.selected_model, "claude-sonnet-4-6");
  assert.equal(result.stats.max_output_tokens, 64_000);
  assert.equal(result.stats.model_context_tokens, 1_000_000);
  assert.equal(
    result.stats.estimated_input_plus_max_output_tokens,
    result.stats.estimated_input_tokens + 64_000,
  );
  assert.ok(result.stats.estimated_context_headroom_tokens > 0);
  assert.equal(result.stats.raw_pdf_files_sent, 0);
});

test("Anthropic local preflight rejects an unsupported output allowance before any provider call", async () => {
  const text = "Policy POL-44 covers marine cargo.";
  const file = {
    originalname: "policy.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(text),
    buffer: Buffer.from(text),
  };
  await assert.rejects(
    validateAnthropicClaimLocally({
      claim: { id: "invalid-output-limit" },
      manifest: [{ id: "document-1", file_name: "policy.txt", category: "Policy" }],
      files: [file],
      env: { ...configuredEnv, ANTHROPIC_MAX_OUTPUT_TOKENS: "128001" },
    }),
    (error) => error instanceof AnthropicPreflightError
      && error.code === "anthropic-output-token-limit-invalid",
  );
});

test("Anthropic local preparation removes repeated lines without dropping unique evidence", async () => {
  const text = [
    "ULA CLAIM HEADER",
    "Policy number POL-44",
    "ULA CLAIM HEADER",
    "Invoice total USD 1,000",
  ].join("\n");
  const file = {
    originalname: "repeated.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(text),
    buffer: Buffer.from(text),
  };
  const result = await validateAnthropicClaimLocally({
    claim: { id: "claim-deduplicated" },
    manifest: [{ id: "document-1", file_name: "repeated.txt", category: "Other" }],
    files: [file],
    env: configuredEnv,
  });

  assert.equal(result.stats.local_reduction.duplicate_lines_removed, 1);
  assert.ok(result.stats.sent_text_characters < result.stats.extracted_text_characters);
  assert.match(result.evidence[0].pages[0].text, /Policy number POL-44/);
  assert.match(result.evidence[0].pages[0].text, /Invoice total USD 1,000/);
});

test("Anthropic local preflight blocks a request above the configured token ceiling", async () => {
  const text = "A".repeat(5_000);
  const file = {
    originalname: "large.txt",
    mimetype: "text/plain",
    size: Buffer.byteLength(text),
    buffer: Buffer.from(text),
  };
  await assert.rejects(
    validateAnthropicClaimLocally({
      claim: { id: "claim-too-large" },
      manifest: [{ id: "document-1", file_name: "large.txt", category: "Other" }],
      files: [file],
      env: { ...configuredEnv, ANTHROPIC_MAX_ESTIMATED_INPUT_TOKENS: "10" },
    }),
    (error) => error instanceof AnthropicPreflightError && error.code === "preflight-token-limit",
  );
});

test("Anthropic connectivity preflight returns the exact provider rejection without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    testAnthropicConnectivity({
      env: configuredEnv,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }), { status: 401, headers: { "request-id": "req_rejected" } });
      },
    }),
    (error) => error.message === "invalid x-api-key" && error.providerStatus === 401,
  );
  assert.equal(calls, 1);
});
