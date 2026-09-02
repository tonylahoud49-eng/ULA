import { createOpenAIProvider } from "./providers/openaiProvider.mjs";
import { createOpenRouterProvider } from "./providers/openrouterProvider.mjs";
import { createGeminiProvider } from "./providers/geminiProvider.mjs";
import { createAnthropicProvider } from "./providers/anthropicProvider.mjs";

const PROVIDER_CONFIGS = {
  anthropic: {
    keyVar: "ANTHROPIC_API_KEY",
    fallbackKeyVars: ["ANTHROTIC_API_KEY"],
    modelVar: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-4-6",
    factory: createAnthropicProvider,
  },
  groq: {
    keyVar: "GROQ_API_KEY",
    modelVar: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
    factory: createGroqProvider,
  },
  gemini: {
    keyVar: "GEMINI_API_KEY",
    fallbackKeyVars: ["GEMINI_API_KEY_2"],
    modelVar: "GEMINI_MODEL",
    defaultModel: "gemini-3.6-flash",
    factory: createGeminiProvider,
  },
  openrouter: {
    keyVar: "OPENROUTER_API_KEY",
    modelVar: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct",
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
const CLOUD_FALLBACK_ORDER = ["openrouter", "groq", "gemini", "anthropic", "openai"];

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
    primaryName = allConfigured[0].provider;
    primaryStatus = allConfigured[0];
  }

  const fallbacks = allConfigured
    .filter((s) => s.provider !== primaryName)
    .map(({ provider, model }) => ({ provider, model }));

  return {
    ...primaryStatus,
    configured_providers: allConfigured.map(({ provider, model }) => ({ provider, model })),
    fallbacks,
  };
}

function instantiate(name, env, modelOverride) {
  const config = PROVIDER_CONFIGS[name];
  if (!config) return null;
  const model = modelOverride || env[config.modelVar] || config.defaultModel;
  const apiKey = env[config.keyVar] || (config.fallbackKeyVars || []).map((keyVar) => env[keyVar]).find(Boolean);
  if (!apiKey) return null;
  const options = { apiKey, model };
  if (name === "anthropic") {
    options.maxOutputTokens = env.ANTHROPIC_MAX_OUTPUT_TOKENS;
  }
  if (name === "openrouter") {
    options.fallbackModels = env.OPENROUTER_FALLBACK_MODELS;
    options.maxCompletionTokens = env.OPENROUTER_MAX_COMPLETION_TOKENS;
  }
  return config.factory(options);
}

export function createConfiguredProvider(options = {}, env = process.env) {
  const looksLikeEnvironment = options && typeof options === "object"
    && !Object.hasOwn(options, "providerName")
    && !Object.hasOwn(options, "modelName")
    && !Object.hasOwn(options, "disableFallback")
    && ["AI_PROVIDER", ...Object.values(PROVIDER_CONFIGS).flatMap((config) => [config.keyVar, ...(config.fallbackKeyVars || [])])]
      .some((key) => Object.hasOwn(options, key));
  if (looksLikeEnvironment) {
    env = options;
    options = {};
  }
  const { providerName, modelName, disableFallback } = options;
  const status = getAIStatus(env);
  if (!status.configured) {
    return { status, provider: null };
  }

  const targetProvider = (providerName && PROVIDER_CONFIGS[providerName.toLowerCase()])
    ? providerName.toLowerCase()
    : status.provider;

  const targetModel = modelName || (targetProvider === status.provider ? status.model : null);

  const primary = instantiate(targetProvider, env, targetModel);
  const fallbacks = disableFallback
    ? []
    : (status.configured_providers || [])
        .filter((p) => p.provider !== targetProvider)
        .map((p) => instantiate(p.provider, env))
        .filter(Boolean);

  const allProviders = [primary, ...fallbacks].filter(Boolean);

  if (!allProviders.length) {
    return { status, provider: null };
  }

  return {
    status,
    provider: {
      name: allProviders[0].name,
      model: allProviders[0].model,
      async analyze(params) {
        let lastError;
        for (const instance of allProviders) {
          try {
            const res = await instance.analyze(params);
            return {
              ...res,
              provider: res.provider || instance.name,
              model: res.model || instance.model,
            };
          } catch (error) {
            error.provider = instance.name;
            error.model = instance.model;
            lastError = error;
            if (allProviders.indexOf(instance) === allProviders.length - 1) {
              throw error;
            }
            console.warn(
              `AI provider ${instance.name} (${instance.model}) failed: ${error.message || error}. ` +
              "Trying next configured fallback…",
            );
          }
        }
        throw lastError;
      },
    },
  };
}
