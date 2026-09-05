import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, parseStructuredJson } from "./openaiProvider.mjs";
import { calculateAiUsage } from "../billingCalculator.mjs";

/**
 * Groq provider — uses the OpenAI SDK pointed at Groq's ultra-fast LPU endpoint.
 *
 * Key details:
 * - Hosted in cloud (zero local GPU/CPU load).
 * - Blazing fast inference speeds (300+ tokens/sec on Llama 3.3 70B).
 * - Uses Chat Completions API with response_format for structured JSON output.
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function createGroqProvider({ apiKey, model, client } = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const openai = client || new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
  });

  return {
    name: "groq",
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

      let response;
      try {
        response = await openai.chat.completions.create({
          model: resolvedModel,
          messages: [
            { role: "system", content: compatibilityInstructions },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          max_completion_tokens: 8192,
        });
      } catch (error) {
        if (Array.isArray(userContent) && (error.message?.includes("must be a string") || [400, 404].includes(Number(error.status)))) {
          const textOnly = userContent.filter((p) => p.type === "text").map((p) => p.text).join("\n\n");
          response = await openai.chat.completions.create({
            model: resolvedModel,
            messages: [
              { role: "system", content: compatibilityInstructions },
              { role: "user", content: textOnly },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_completion_tokens: 8192,
          });
        } else {
          throw error;
        }
      }

      const choice = response.choices?.[0];
      if (!choice?.message?.content) {
        const finishReason = choice?.finish_reason ? `; finish reason: ${choice.finish_reason}` : "";
        throw new Error(`Groq returned no structured analysis${finishReason}.`);
      }

      const parsed = claimAnalysisSchema.parse(parseStructuredJson(choice.message.content));

      const usage = calculateAiUsage({
        provider: "groq",
        model: response.model || resolvedModel,
        rawUsage: response?.usage,
      });

      return {
        provider: "groq",
        model: response.model || resolvedModel,
        response_id: response.id || null,
        analyzed_at: new Date().toISOString(),
        usage,
        analysis: enforceGrounding(parsed, evidence),
      };
    },
  };
}
