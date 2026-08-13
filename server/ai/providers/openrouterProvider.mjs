import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { evidenceText } from "../../evidence/extractEvidence.mjs";
import { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, parseStructuredJson } from "./openaiProvider.mjs";

/**
 * OpenRouter provider — uses the OpenAI SDK pointed at OpenRouter's API.
 *
 * Key differences from the OpenAI provider:
 * - Uses Chat Completions API (`chat.completions.create`) instead of Responses API.
 * - Uses `response_format` with `zodResponseFormat` for structured output.
 * - Sends images as Chat Completions vision content parts (type: "image_url").
 * - Non-image files are included via their extracted text only, since OpenRouter
 *   does not support the Responses API `input_file` content type.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

export function createOpenRouterProvider({ apiKey, model, client } = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const modelCandidates = [...new Set([
    resolvedModel,
    resolvedModel.endsWith(":free") ? resolvedModel.replace(/:free$/, "") : null,
    resolvedModel.includes(":free") ? DEFAULT_MODEL : null,
  ].filter(Boolean))];
  const openai = client || new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/ula-claims-hub",
      "X-Title": "ULA Claims Hub",
    },
  });
  return {
    name: "openrouter",
    model: resolvedModel,
    async analyze({ claim, evidence, files, styleReferences = [] }) {
      // Build a Chat Completions message array.
      // System message carries the analysis instructions.
      // User message carries the prompt text and any vision content.
      const userContent = [
        { type: "text", text: promptText(claim, evidence, styleReferences) },
      ];

      evidence.forEach((item, index) => {
        const file = files[index];
        if (!file) return;
        // OpenRouter Chat Completions supports image_url for vision.
        // PDFs and documents are included through extracted text in the prompt;
        // images are additionally sent as vision content parts.
        if (item.kind === "image") {
          userContent.push({
            type: "image_url",
            image_url: { url: toDataUrl(file), detail: "high" },
          });
        }
        // Embedded images from document extraction
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
      if (responseFormat.json_schema) {
        delete responseFormat.json_schema.strict;
        const cleanSchema = (obj) => {
          if (obj && typeof obj === "object") {
            delete obj.additionalProperties;
            Object.values(obj).forEach(cleanSchema);
          }
        };
        cleanSchema(responseFormat.json_schema.schema);
      }

      let lastError;
      for (const candidateModel of modelCandidates) {
        try {
          const response = await openai.chat.completions.create({
            model: candidateModel,
            messages: [
              { role: "system", content: SYSTEM_INSTRUCTIONS },
              { role: "user", content: userContent },
            ],
            response_format: responseFormat,
          });

          const choice = response.choices?.[0];
          if (!choice?.message?.content) {
            throw new Error("The AI provider returned no structured analysis.");
          }

          let parsed;
          try {
            parsed = claimAnalysisSchema.parse(parseStructuredJson(choice.message.content));
          } catch (parseError) {
            throw new Error(`The AI provider returned invalid structured output: ${parseError.message}`);
          }

          return {
            provider: "openrouter",
            model: candidateModel,
            response_id: response.id || null,
            analyzed_at: new Date().toISOString(),
            analysis: enforceGrounding(parsed, evidence),
          };
        } catch (error) {
          lastError = error;
          if (Number(error?.status) !== 404 || candidateModel === modelCandidates.at(-1)) {
            throw error;
          }
        }
      }
      throw lastError;
    },
  };
}

export { evidenceText };
