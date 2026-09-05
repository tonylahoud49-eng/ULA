import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, parseStructuredJson } from "./openaiProvider.mjs";
import { calculateAiUsage } from "../billingCalculator.mjs";

/**
 * Ollama provider — connects to local or network Ollama instance via its OpenAI-compatible /v1 endpoint.
 *
 * Key details:
 * - 100% free and local.
 * - Host default: http://127.0.0.1:11434/v1
 * - Default model: llama3.3 (or qwen2.5, mistral, deepseek-r1)
 */

const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.3";

export function createOllamaProvider({ host, model, client } = {}) {
  const resolvedHost = (host || process.env.OLLAMA_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  const baseURL = resolvedHost.endsWith("/v1") ? resolvedHost : `${resolvedHost}/v1`;
  const resolvedModel = model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;

  const openai = client || new OpenAI({
    apiKey: "ollama",
    baseURL,
  });

  return {
    name: "ollama",
    model: resolvedModel,
    async analyze({ claim, evidence, files, styleReferences = [] }) {
      const userContent = [
        { type: "text", text: promptText(claim, evidence, styleReferences) },
      ];

      evidence.forEach((item, index) => {
        const file = files[index];
        if (!file) return;
        if (item.kind === "image") {
          userContent.push({
            type: "image_url",
            image_url: { url: toDataUrl(file), detail: "high" },
          });
        }
        (item.embedded_images || []).forEach((embedded) => {
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${embedded.mime_type};base64,${embedded.buffer.toString("base64")}`,
              detail: "high",
            },
          });
        });
      });

      const responseFormat = zodResponseFormat(claimAnalysisSchema, "ula_claim_analysis");
      const compatibilityInstructions = `${SYSTEM_INSTRUCTIONS}\n\nReturn only one valid JSON object matching the required schema strictly; do not use Markdown fences:\n${JSON.stringify(responseFormat.json_schema.schema)}`;

      const response = await openai.chat.completions.create({
        model: resolvedModel,
        messages: [
          { role: "system", content: compatibilityInstructions },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const choice = response.choices?.[0];
      if (!choice?.message?.content) {
        const finishReason = choice?.finish_reason ? `; finish reason: ${choice.finish_reason}` : "";
        throw new Error(`Ollama returned no structured analysis${finishReason}.`);
      }

      const parsed = claimAnalysisSchema.parse(parseStructuredJson(choice.message.content));

      const usage = calculateAiUsage({
        provider: "ollama",
        model: response.model || resolvedModel,
        rawUsage: response?.usage,
      });

      return {
        provider: "ollama",
        model: response.model || resolvedModel,
        response_id: response.id || null,
        analyzed_at: new Date().toISOString(),
        usage,
        analysis: enforceGrounding(parsed, evidence),
      };
    },
  };
}
