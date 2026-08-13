import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, parseStructuredJson } from "./openaiProvider.mjs";

/**
 * Gemini provider — uses the OpenAI SDK pointed at Google's OpenAI-compatible endpoint.
 *
 * Key details:
 * - Uses Chat Completions API via Google's compatibility layer.
 * - Uses `response_format` with `zodResponseFormat` for structured output.
 * - Sends images as Chat Completions vision content parts (type: "image_url").
 * - PDFs are sent as image_url data URIs (Gemini handles multi-page PDF vision natively).
 * - Non-image/PDF files are included via their extracted text in the prompt.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = "gemini-2.5-flash";

export function createGeminiProvider({ apiKey, model, client } = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const openai = client || new OpenAI({
    apiKey,
    baseURL: GEMINI_BASE_URL,
  });
  return {
    name: "gemini",
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
        } else if (item.kind === "pdf") {
          // Gemini handles PDF vision natively through the OpenAI-compatible endpoint.
          userContent.push({
            type: "image_url",
            image_url: { url: toDataUrl(file), detail: "auto" },
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

      let response;
      try {
        response = await openai.chat.completions.create({
          model: resolvedModel,
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTIONS },
            { role: "user", content: userContent },
          ],
          response_format: responseFormat,
        });
      } catch (error) {
        if (Number(error?.status) === 404) {
          response = await openai.chat.completions.create({
            model: resolvedModel,
            messages: [
              { role: "system", content: SYSTEM_INSTRUCTIONS },
              { role: "user", content: userContent },
            ],
          });
        } else {
          throw error;
        }
      }

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
        provider: "gemini",
        model: resolvedModel,
        response_id: response.id || null,
        analyzed_at: new Date().toISOString(),
        analysis: enforceGrounding(parsed, evidence),
      };
    },
  };
}
