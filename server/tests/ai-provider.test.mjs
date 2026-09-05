import test from "node:test";
import assert from "node:assert/strict";
import { calculateAnthropicUsage } from "../ai/providers/anthropicProvider.mjs";

test("calculateAnthropicUsage handles empty usage gracefully", () => {
  const result = calculateAnthropicUsage();
  assert.equal(result.input_tokens, 0);
  assert.equal(result.output_tokens, 0);
  assert.equal(result.estimated_cost_usd, 0);
});

test("calculateAnthropicUsage calculates standard Sonnet usage accurately", () => {
  const result = calculateAnthropicUsage({
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 20_000,
      output_tokens: 2_000,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  });

  // 20,000 * $3/MTok = $0.060
  // 2,000 * $15/MTok = $0.030
  // Total = $0.090
  assert.equal(result.input_tokens, 20_000);
  assert.equal(result.output_tokens, 2_000);
  assert.equal(result.total_tokens, 22_000);
  assert.equal(result.estimated_cost_usd, 0.09);
});

test("calculateAnthropicUsage applies 90% discount on cached input tokens", () => {
  const result = calculateAnthropicUsage({
    model: "claude-sonnet-4-6",
    usage: {
      input_tokens: 20_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 15_000,
      cache_creation_input_tokens: 0,
    },
  });

  // Regular input: 5,000 * $3/MTok = $0.015
  // Cache read: 15,000 * $0.30/MTok = $0.0045
  // Output: 1,000 * $15/MTok = $0.015
  // Total = $0.0345
  assert.equal(result.input_tokens, 20_000);
  assert.equal(result.cache_read_input_tokens, 15_000);
  assert.equal(result.estimated_cost_usd, 0.0345);
});

test("calculateAnthropicUsage adjusts rates for Opus model", () => {
  const result = calculateAnthropicUsage({
    model: "claude-opus-4-6",
    usage: {
      input_tokens: 10_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 0,
    },
  });

  // Opus input: 10,000 * $15/MTok = $0.150
  // Opus output: 1,000 * $75/MTok = $0.075
  // Total = $0.225
  assert.equal(result.estimated_cost_usd, 0.225);
});
