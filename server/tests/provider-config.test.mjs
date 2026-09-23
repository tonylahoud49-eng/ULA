import test from "node:test";
import assert from "node:assert/strict";
import { createConfiguredProvider, getAIStatus } from "../ai/provider.mjs";

test("Gemini is available when its API key and selected model are configured", () => {
  const env = {
    AI_PROVIDER: "GEMINI",
    GEMINI_API_KEY: "test-gemini-key",
    GEMINI_MODEL: "gemini-3.7-flash",
  };
  const status = getAIStatus(env);
  const { provider } = createConfiguredProvider({ providerName: "gemini", modelName: "gemini-3.7-flash" }, env);

  assert.equal(status.configured, true);
  assert.deepEqual(status.configured_providers, [{ provider: "gemini", model: "gemini-3.7-flash" }]);
  assert.equal(provider.name, "gemini");
  assert.equal(provider.model, "gemini-3.7-flash");
});

test("automatic fallback never spends Anthropic credit", () => {
  const env = {
    AI_PROVIDER: "GEMINI",
    GEMINI_API_KEY: "gemini",
    OPENROUTER_API_KEY: "openrouter",
    ANTHROPIC_API_KEY: "anthropic",
  };
  const { provider } = createConfiguredProvider({ providerName: "gemini" }, env);
  assert.equal(provider.name, "gemini");
});
