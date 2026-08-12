import { createOpenAIProvider } from "./providers/openaiProvider.mjs";

export function getAIStatus(env = process.env) {
  const provider = String(env.AI_PROVIDER || "openai").toLowerCase();
  if (provider !== "openai") {
    return { configured: false, provider, model: null, reason: `Unsupported AI provider: ${provider}.` };
  }
  if (!env.OPENAI_API_KEY) {
    return {
      configured: false,
      provider: "openai",
      model: env.OPENAI_MODEL || "gpt-5.6-terra",
      reason: "AI provider is not configured. Add OPENAI_API_KEY to the server environment.",
    };
  }
  return { configured: true, provider: "openai", model: env.OPENAI_MODEL || "gpt-5.6-terra", reason: null };
}

export function createConfiguredProvider(env = process.env) {
  const status = getAIStatus(env);
  if (!status.configured) return { status, provider: null };
  return {
    status,
    provider: createOpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: status.model }),
  };
}
