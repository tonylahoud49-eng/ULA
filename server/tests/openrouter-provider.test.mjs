import test from "node:test";
import assert from "node:assert/strict";
import { createOpenRouterProvider } from "../ai/providers/openrouterProvider.mjs";

test("OpenRouter does not silently try unconfigured paid models", async () => {
  const models = [];
  const client = { chat: { completions: { create: async ({ model }) => {
    models.push(model);
    const error = new Error("not found");
    error.status = 404;
    throw error;
  } } } };
  const provider = createOpenRouterProvider({ model: "openrouter/free", fallbackModels: [], client });
  await assert.rejects(() => provider.analyze({ claim: {}, evidence: [], files: [] }));
  assert.deepEqual(models, ["openrouter/free"]);
});
