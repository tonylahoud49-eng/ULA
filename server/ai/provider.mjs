import { createOpenAIProvider } from "./providers/openaiProvider.mjs";
import { createOpenRouterProvider } from "./providers/openrouterProvider.mjs";
import { createGeminiProvider } from "./providers/geminiProvider.mjs";
import { createAnthropicProvider } from "./providers/anthropicProvider.mjs";

const PROVIDER_CONFIGS = {
  anthropic: {
    keyVar: "ANTHROPIC_API_KEY",
    fallbackKeyVars: ["ANTHROTIC_API_KEY"],
    modelVar: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-5",
    factory: createAnthropicProvider,
  },
  gemini: {
    keyVar: "GEMINI_API_KEY",
    fallbackKeyVars: ["GEMINI_API_KEY_2"],
    modelVar: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    factory: createGeminiProvider,
  },
  openrouter: {
    keyVar: "OPENROUTER_API_KEY",
    modelVar: "OPENROUTER_MODEL",
    defaultModel: "google/gemma-4-31b-it:free",
    factory: createOpenRouterProvider,
  },
  openai: {
    keyVar: "OPENAI_API_KEY",
    modelVar: "OPENAI_MODEL",
    defaultModel: "gpt-5.6-terra",
    factory: createOpenAIProvider,
  },
};

/** Default fallback order for cloud providers. */
const CLOUD_FALLBACK_ORDER = ["anthropic", "gemini", "openrouter", "openai"];

function statusForProvider(name, env) {
  const config = PROVIDER_CONFIGS[name];
  if (!config) {
    return { configured: false, provider: name, model: null, reason: `Unsupported AI provider: ${name}.` };
  }
  const model = env[config.modelVar] || config.defaultModel;
  const hasPrimaryKey = Boolean(env[config.keyVar]);
  const hasFallbackKey = (config.fallbackKeyVars || []).some((keyVar) => Boolean(env[keyVar]));
  if (!hasPrimaryKey && !hasFallbackKey) {
    return {
      configured: false,
      provider: name,
      model,
      reason: `AI provider is not configured. Add ${config.keyVar} to the server environment.`,
    };
  }
  return { configured: true, provider: name, model, reason: null };
}

export function getAIStatus(env = process.env) {
  let primaryName = String(env.AI_PROVIDER || "openai").toLowerCase();
  let primaryStatus = statusForProvider(primaryName, env);

  // Find all configured providers
  const allConfigured = CLOUD_FALLBACK_ORDER
    .map((name) => statusForProvider(name, env))
    .filter((s) => s.configured);

  if (!primaryStatus.configured && allConfigured.length > 0) {
    // Promote the first configured provider to primary
    primaryName = allConfigured[0].provider;
    primaryStatus = allConfigured[0];
  }

  const fallbacks = CLOUD_FALLBACK_ORDER
    .filter((name) => name !== primaryName)
    .map((name) => statusForProvider(name, env))
    .filter((s) => s.configured);

  return {
    ...primaryStatus,
    fallbacks: fallbacks.map(({ provider, model }) => ({ provider, model })),
  };
}

function instantiate(name, env) {
  const config = PROVIDER_CONFIGS[name];
  if (!config) return null;
  const model = env[config.modelVar] || config.defaultModel;
  const apiKey = env[config.keyVar] || (config.fallbackKeyVars || []).map((keyVar) => env[keyVar]).find(Boolean);
  const options = { apiKey, model };
  if (name === "openrouter") {
    options.fallbackModels = env.OPENROUTER_FALLBACK_MODELS;
    options.maxCompletionTokens = env.OPENROUTER_MAX_COMPLETION_TOKENS;
  }
  return config.factory(options);
}

export function createConfiguredProvider(env = process.env) {
  const status = getAIStatus(env);
  if (!status.configured) {
    return { status, provider: null };
  }

  const primary = instantiate(status.provider, env);
  const fallbackInstances = (status.provider === "anthropic" ? [] : status.fallbacks || [])
    .map(({ provider: name }) => instantiate(name, env))
    .filter(Boolean);

  const allProviders = [primary, ...fallbackInstances].filter(Boolean);

  return {
    status,
    provider: {
      name: allProviders[0].name,
      model: allProviders[0].model,
      async analyze(params) {
        let lastError;
        for (const instance of allProviders) {
          try {
            return await instance.analyze(params);
          } catch (error) {
            lastError = error;
            // Fallback to the next provider for ANY error if one is available
            if (allProviders.indexOf(instance) === allProviders.length - 1) {
              throw error;
            }
            console.warn(
              `AI provider ${instance.name} (${instance.model}) failed: ${error.message || error}. ` +
              "Trying next fallback…",
            );
          }
        }
        throw lastError;
      },
    },
  };
}
