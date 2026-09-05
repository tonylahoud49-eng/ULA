/**
 * AI Billing & Cost Calculator
 *
 * Centralized pricing engine for multi-provider AI usage calculations.
 * Supports Free Tier providers (Google Gemini AI Studio, Groq Cloud, Ollama, OpenRouter :free)
 * and Paid Tier providers (Anthropic Claude, OpenAI, OpenRouter Paid).
 */

export const MODEL_PRICING_TABLE = {
  // Google Gemini — AI Studio Free Tier
  gemini: {
    isFree: true,
    tierLabel: "Free Tier",
    inputRate: 0.0,
    outputRate: 0.0,
    cacheReadRate: 0.0,
    description: "Google AI Studio Free Tier ($0.00 / 1M tokens)",
  },

  // Groq Cloud — Developer Free Tier
  groq: {
    isFree: true,
    tierLabel: "Free Tier",
    inputRate: 0.0,
    outputRate: 0.0,
    cacheReadRate: 0.0,
    description: "Groq Cloud Free Tier ($0.00 / 1M tokens)",
  },

  // Ollama — Local Inference
  ollama: {
    isFree: true,
    tierLabel: "Self-Hosted",
    inputRate: 0.0,
    outputRate: 0.0,
    cacheReadRate: 0.0,
    description: "Local Ollama Inference ($0.00 / Self-Hosted)",
  },

  // Anthropic Claude
  anthropic: {
    sonnet: {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 3.00,
      cacheReadRate: 0.30, // 90% discount on cached tokens
      cacheWriteRate: 3.75,
      outputRate: 15.00,
      description: "Anthropic Claude Sonnet ($3.00 in / $0.30 cache / $15.00 out per 1M)",
    },
    opus: {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 15.00,
      cacheReadRate: 1.50,
      cacheWriteRate: 18.75,
      outputRate: 75.00,
      description: "Anthropic Claude Opus ($15.00 in / $1.50 cache / $75.00 out per 1M)",
    },
    haiku: {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 0.80,
      cacheReadRate: 0.08,
      cacheWriteRate: 1.00,
      outputRate: 4.00,
      description: "Anthropic Claude Haiku ($0.80 in / $0.08 cache / $4.00 out per 1M)",
    },
  },

  // OpenAI
  openai: {
    "gpt-4o-mini": {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 0.15,
      cacheReadRate: 0.075,
      cacheWriteRate: 0.15,
      outputRate: 0.60,
      description: "OpenAI GPT-4o-mini ($0.15 in / $0.60 out per 1M)",
    },
    "gpt-4o": {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 2.50,
      cacheReadRate: 1.25,
      cacheWriteRate: 2.50,
      outputRate: 10.00,
      description: "OpenAI GPT-4o ($2.50 in / $10.00 out per 1M)",
    },
    default: {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 3.00,
      cacheReadRate: 1.50,
      cacheWriteRate: 3.00,
      outputRate: 15.00,
      description: "OpenAI Enterprise/Standard ($3.00 in / $15.00 out per 1M)",
    },
  },

  // OpenRouter
  openrouter: {
    free: {
      isFree: true,
      tierLabel: "Free Tier",
      inputRate: 0.0,
      outputRate: 0.0,
      cacheReadRate: 0.0,
      description: "OpenRouter Free Model ($0.00 / 1M tokens)",
    },
    "meta-llama/llama-3.3-70b-instruct": {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 0.12,
      outputRate: 0.30,
      cacheReadRate: 0.12,
      description: "Llama 3.3 70B via OpenRouter ($0.12 in / $0.30 out per 1M)",
    },
    "deepseek/deepseek-chat": {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 0.14,
      outputRate: 0.28,
      cacheReadRate: 0.14,
      description: "DeepSeek Chat via OpenRouter ($0.14 in / $0.28 out per 1M)",
    },
    default: {
      isFree: false,
      tierLabel: "Paid Tier",
      inputRate: 0.20,
      outputRate: 0.50,
      cacheReadRate: 0.20,
      description: "OpenRouter Standard Model ($0.20 in / $0.50 out per 1M)",
    },
  },
};

/**
 * Identify if a provider and model combo qualifies for free tier.
 */
export function isFreeTierModel(provider = "", model = "") {
  const normProvider = String(provider).toLowerCase().trim();
  const normModel = String(model).toLowerCase().trim();

  if (["gemini", "groq", "ollama"].includes(normProvider)) return true;
  if (normModel.endsWith(":free") || normModel.includes(":free/")) return true;
  return false;
}

/**
 * Resolve the pricing tier rule for a given provider and model.
 */
export function getModelPricing(provider = "", model = "") {
  const normProvider = String(provider).toLowerCase().trim();
  const normModel = String(model).toLowerCase().trim();

  if (normProvider === "gemini") return MODEL_PRICING_TABLE.gemini;
  if (normProvider === "groq") return MODEL_PRICING_TABLE.groq;
  if (normProvider === "ollama") return MODEL_PRICING_TABLE.ollama;

  if (normProvider === "openrouter") {
    if (normModel.endsWith(":free") || normModel.includes(":free/")) {
      return MODEL_PRICING_TABLE.openrouter.free;
    }
    for (const [key, rate] of Object.entries(MODEL_PRICING_TABLE.openrouter)) {
      if (key !== "free" && key !== "default" && normModel.includes(key)) {
        return rate;
      }
    }
    return MODEL_PRICING_TABLE.openrouter.default;
  }

  if (normProvider === "anthropic") {
    if (normModel.includes("opus")) return MODEL_PRICING_TABLE.anthropic.opus;
    if (normModel.includes("haiku")) return MODEL_PRICING_TABLE.anthropic.haiku;
    return MODEL_PRICING_TABLE.anthropic.sonnet;
  }

  if (normProvider === "openai") {
    if (normModel.includes("mini")) return MODEL_PRICING_TABLE.openai["gpt-4o-mini"];
    if (normModel.includes("4o")) return MODEL_PRICING_TABLE.openai["gpt-4o"];
    return MODEL_PRICING_TABLE.openai.default;
  }

  // Fallback for unknown provider
  if (isFreeTierModel(normProvider, normModel)) {
    return {
      isFree: true,
      tierLabel: "Free Tier",
      inputRate: 0.0,
      outputRate: 0.0,
      cacheReadRate: 0.0,
      description: "Free Tier / Local Inference ($0.00)",
    };
  }

  return {
    isFree: false,
    tierLabel: "Paid Tier",
    inputRate: 2.00,
    outputRate: 10.00,
    cacheReadRate: 1.00,
    description: "Standard Paid Tier",
  };
}

/**
 * Calculate token usage and accurate billing across all providers.
 * Correctly marks free-tier models as $0.00 USD and highlights cache discounts.
 */
export function calculateAiUsage({
  provider = "",
  model = "",
  rawUsage = null,
  inputTokens = null,
  outputTokens = null,
} = {}) {
  const pricing = getModelPricing(provider, model);

  // Extract raw token counts handling various SDK formats (Anthropic vs OpenAI vs Gemini vs Groq)
  const totalInput = Number(
    inputTokens
    ?? rawUsage?.input_tokens
    ?? rawUsage?.prompt_tokens
    ?? 0
  );

  const totalOutput = Number(
    outputTokens
    ?? rawUsage?.output_tokens
    ?? rawUsage?.completion_tokens
    ?? 0
  );

  const cacheRead = Number(
    rawUsage?.cache_read_input_tokens
    ?? rawUsage?.prompt_tokens_details?.cached_tokens
    ?? 0
  );

  const cacheCreation = Number(
    rawUsage?.cache_creation_input_tokens
    ?? 0
  );

  const totalTokens = totalInput + totalOutput;

  if (pricing.isFree) {
    // Free models incur $0.00 cost
    // We compute what it would have costed on standard commercial rates to illustrate value saved
    const commercialBenchmarkRate = 3.00; // $3.00/MTok benchmark
    const savingsVsPaid = Number(((totalTokens / 1_000_000) * commercialBenchmarkRate).toFixed(4));

    return {
      provider,
      model,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation,
      total_tokens: totalTokens,
      is_free_tier: true,
      tier_label: pricing.tierLabel,
      estimated_cost_usd: 0.0000,
      estimated_savings_usd: savingsVsPaid,
      pricing_description: pricing.description,
    };
  }

  // Paid models
  const regularInput = Math.max(0, totalInput - cacheRead - cacheCreation);
  const inputCost = (regularInput / 1_000_000) * pricing.inputRate;
  const cacheReadCost = (cacheRead / 1_000_000) * (pricing.cacheReadRate ?? pricing.inputRate);
  const cacheCreationCost = (cacheCreation / 1_000_000) * (pricing.cacheWriteRate ?? pricing.inputRate);
  const outputCost = (totalOutput / 1_000_000) * pricing.outputRate;

  const totalCost = inputCost + cacheReadCost + cacheCreationCost + outputCost;

  // Cache savings (e.g. 90% discount on Anthropic cached tokens)
  const cacheSavings = cacheRead > 0
    ? Number(((cacheRead / 1_000_000) * (pricing.inputRate - (pricing.cacheReadRate ?? pricing.inputRate))).toFixed(4))
    : 0.0000;

  return {
    provider,
    model,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    total_tokens: totalTokens,
    is_free_tier: false,
    tier_label: pricing.tierLabel,
    estimated_cost_usd: Number(totalCost.toFixed(4)),
    estimated_savings_usd: cacheSavings,
    pricing_description: pricing.description,
  };
}

/**
 * Estimate preflight cost before running an analysis.
 */
export function estimatePreflightCost(provider = "", model = "", estimatedInputTokens = 0) {
  const pricing = getModelPricing(provider, model);
  if (pricing.isFree) {
    return {
      is_free_tier: true,
      tier_label: pricing.tierLabel,
      estimated_cost_usd: 0.0000,
      pricing_description: pricing.description,
    };
  }

  const cost = (estimatedInputTokens / 1_000_000) * pricing.inputRate;
  return {
    is_free_tier: false,
    tier_label: pricing.tierLabel,
    estimated_cost_usd: Number(cost.toFixed(4)),
    pricing_description: pricing.description,
  };
}
