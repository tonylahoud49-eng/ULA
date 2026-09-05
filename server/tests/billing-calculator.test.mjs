import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAiUsage,
  isFreeTierModel,
  estimatePreflightCost,
} from "../ai/billingCalculator.mjs";

test("isFreeTierModel correctly detects free models across providers", () => {
  assert.equal(isFreeTierModel("gemini", "gemini-3.6-flash"), true);
  assert.equal(isFreeTierModel("groq", "openai/gpt-oss-120b"), true);
  assert.equal(isFreeTierModel("ollama", "llama3.3"), true);
  assert.equal(isFreeTierModel("openrouter", "google/gemini-2.0-flash-exp:free"), true);
  assert.equal(isFreeTierModel("openrouter", "meta-llama/llama-3.3-70b-instruct:free"), true);

  assert.equal(isFreeTierModel("anthropic", "claude-sonnet-4-6"), false);
  assert.equal(isFreeTierModel("openai", "gpt-4o"), false);
  assert.equal(isFreeTierModel("openrouter", "meta-llama/llama-3.3-70b-instruct"), false);
});

test("Google Gemini usage is billed at exactly $0.00 with Free Tier label", () => {
  const usage = calculateAiUsage({
    provider: "gemini",
    model: "gemini-3.6-flash",
    rawUsage: {
      prompt_tokens: 50_000,
      completion_tokens: 4_000,
    },
  });

  assert.equal(usage.is_free_tier, true);
  assert.equal(usage.tier_label, "Free Tier");
  assert.equal(usage.estimated_cost_usd, 0.0000);
  assert.equal(usage.input_tokens, 50_000);
  assert.equal(usage.output_tokens, 4_000);
  assert.equal(usage.total_tokens, 54_000);
  assert.ok(usage.estimated_savings_usd > 0, "Calculates savings against commercial benchmark");
});

test("Groq Cloud usage is billed at exactly $0.00 with Free Tier label", () => {
  const usage = calculateAiUsage({
    provider: "groq",
    model: "openai/gpt-oss-120b",
    rawUsage: {
      prompt_tokens: 35_000,
      completion_tokens: 3_500,
    },
  });

  assert.equal(usage.is_free_tier, true);
  assert.equal(usage.tier_label, "Free Tier");
  assert.equal(usage.estimated_cost_usd, 0.0000);
  assert.equal(usage.total_tokens, 38_500);
});

test("Ollama usage is billed at exactly $0.00 with Self-Hosted label", () => {
  const usage = calculateAiUsage({
    provider: "ollama",
    model: "llama3.3",
    rawUsage: {
      prompt_tokens: 20_000,
      completion_tokens: 2_000,
    },
  });

  assert.equal(usage.is_free_tier, true);
  assert.equal(usage.tier_label, "Self-Hosted");
  assert.equal(usage.estimated_cost_usd, 0.0000);
  assert.equal(usage.total_tokens, 22_000);
});

test("OpenRouter free models are billed at $0.00 while paid models use their rates", () => {
  const freeUsage = calculateAiUsage({
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    rawUsage: {
      prompt_tokens: 40_000,
      completion_tokens: 4_000,
    },
  });
  assert.equal(freeUsage.is_free_tier, true);
  assert.equal(freeUsage.estimated_cost_usd, 0.0000);

  const paidUsage = calculateAiUsage({
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct",
    rawUsage: {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
    },
  });
  assert.equal(paidUsage.is_free_tier, false);
  // $0.12 in + $0.30 out = $0.42
  assert.equal(paidUsage.estimated_cost_usd, 0.4200);
});

test("Anthropic Sonnet factors in 90% prompt caching discount", () => {
  const usage = calculateAiUsage({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    rawUsage: {
      input_tokens: 100_000,
      output_tokens: 2_000,
      cache_read_input_tokens: 80_000,
      cache_creation_input_tokens: 0,
    },
  });

  assert.equal(usage.is_free_tier, false);
  assert.equal(usage.input_tokens, 100_000);
  assert.equal(usage.cache_read_input_tokens, 80_000);
  assert.equal(usage.output_tokens, 2_000);
  assert.equal(usage.total_tokens, 102_000);

  // regular input: 20k @ $3/M = $0.06
  // cached read: 80k @ $0.30/M = $0.024
  // output: 2k @ $15/M = $0.030
  // total: 0.06 + 0.024 + 0.030 = 0.114
  assert.equal(usage.estimated_cost_usd, 0.1140);
  // savings on 80k cached: 80k * (3.00 - 0.30) / 1M = 0.2160
  assert.equal(usage.estimated_savings_usd, 0.2160);
});

test("estimatePreflightCost distinguishes free tier from paid tier", () => {
  const freeEst = estimatePreflightCost("gemini", "gemini-3.6-flash", 150_000);
  assert.equal(freeEst.is_free_tier, true);
  assert.equal(freeEst.estimated_cost_usd, 0.0000);

  const groqEst = estimatePreflightCost("groq", "openai/gpt-oss-120b", 80_000);
  assert.equal(groqEst.is_free_tier, true);
  assert.equal(groqEst.estimated_cost_usd, 0.0000);

  const anthropicEst = estimatePreflightCost("anthropic", "claude-sonnet-4-6", 100_000);
  assert.equal(anthropicEst.is_free_tier, false);
  // 100k @ $3/M = 0.30
  assert.equal(anthropicEst.estimated_cost_usd, 0.3000);
});
