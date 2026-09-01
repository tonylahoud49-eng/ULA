import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { BUSINESS_LINES, DOCUMENT_TYPES, claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
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
const DEFAULT_MAX_COMPLETION_TOKENS = 16_384;

function normalizeFallbackModels(value, primaryModel) {
  if (value === undefined) {
    return primaryModel.endsWith(":free") && primaryModel !== "openrouter/free"
      ? ["openrouter/free"]
      : [];
  }
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((item) => String(item).trim()).filter((item) => item && item !== primaryModel))];
}

function normalizeMaxCompletionTokens(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_COMPLETION_TOKENS;
  return Math.min(32_768, Math.max(2_048, Math.floor(parsed)));
}

function isRetryableRequestError(error) {
  const status = Number(error?.status);
  if (status === 400 && /maximum context length|requested about.*tokens|reduce the length/i.test(error?.message || "")) {
    return true;
  }
  if ([404, 408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) {
    return true;
  }
  return /terminated|timed?\s*out|socket|network|fetch failed|connection (?:closed|reset)/i.test(error?.message || "");
}

function parseStructuredAnalysis(response) {
  const choice = response.choices?.[0];
  if (!choice?.message?.content) {
    const finishReason = choice?.finish_reason ? `; finish reason: ${choice.finish_reason}` : "";
    const refusal = choice?.message?.refusal ? `; refusal: ${choice.message.refusal}` : "";
    throw new Error(`The AI provider returned no structured analysis${finishReason}${refusal}.`);
  }
  try {
    return claimAnalysisSchema.parse(parseStructuredJson(choice.message.content));
  } catch (error) {
    const finishReason = choice.finish_reason ? `; finish reason: ${choice.finish_reason}` : "";
    throw new Error(`The AI provider returned invalid structured output${finishReason}: ${error.message}`);
  }
}

function requiresJsonObjectCompatibility(model) {
  const normalized = String(model || "").toLowerCase();
  return normalized === "openrouter/free" || normalized.startsWith("google/gemma-4-");
}

function unwrapAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  for (const key of ["analysis", "result", "output"]) {
    const nested = value[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return value;
}

function validArrayItems(value, schema) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizeMissingDocuments(value) {
  if (!Array.isArray(value)) return [];
  const schema = claimAnalysisSchema.shape.missing_documents.element;
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const documentType = DOCUMENT_TYPES.find((type) => type.toLowerCase() === item.trim().toLowerCase());
      if (!documentType) return [];
      return [{
        document_type: documentType,
        reason: `The provider identified ${documentType} as missing, but returned no structured rationale.`,
        missing_information: [`Substantive ${documentType} content requires confirmation.`],
      }];
    }
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizePartialAnalysis(value) {
  const candidate = unwrapAnalysis(value);
  const classificationResult = claimAnalysisSchema.shape.classification.safeParse(candidate.classification);
  const classification = classificationResult.success
    ? classificationResult.data
    : {
        business_line: "Other / Requires Review",
        confidence: 0,
        rationale: "The AI provider returned only a partial analysis, so business-line classification requires review.",
        sources: [],
      };
  if (!BUSINESS_LINES.includes(classification.business_line)) classification.business_line = "Other / Requires Review";

  const normalized = {
    classification,
    document_types: validArrayItems(candidate.document_types, claimAnalysisSchema.shape.document_types.element),
    fields: validArrayItems(candidate.fields, claimAnalysisSchema.shape.fields.element),
    adjustment_line_items: validArrayItems(candidate.adjustment_line_items, claimAnalysisSchema.shape.adjustment_line_items.element),
    missing_documents: normalizeMissingDocuments(candidate.missing_documents),
    evidence_findings: validArrayItems(candidate.evidence_findings, claimAnalysisSchema.shape.evidence_findings.element),
    summary: typeof candidate.summary === "string" && candidate.summary.trim()
      ? candidate.summary
      : "The AI provider returned a partial analysis. Available structured findings were retained for human review.",
    warnings: [
      ...(Array.isArray(candidate.warnings) ? candidate.warnings.filter((item) => typeof item === "string") : []),
      "The AI provider returned an incomplete schema. Missing sections were safely defaulted and require human review.",
    ],
    human_review_required: [
      ...(Array.isArray(candidate.human_review_required)
        ? candidate.human_review_required.filter((item) => typeof item === "string")
        : []),
      "Review the incomplete AI response and confirm all document-presence findings.",
    ],
  };
  return claimAnalysisSchema.parse(normalized);
}

export function createOpenRouterProvider({
  apiKey,
  model,
  fallbackModels,
  maxCompletionTokens,
  client,
} = {}) {
  const resolvedModel = model || DEFAULT_MODEL;
  const modelCandidates = [...new Set([
    resolvedModel,
    resolvedModel.endsWith(":free") ? resolvedModel.replace(/:free$/, "") : null,
    resolvedModel.includes(":free") ? DEFAULT_MODEL : null,
    resolvedModel === "openrouter/auto" ? "minimax/minimax-m3:free" : null,
  ].filter(Boolean))];
  const resolvedFallbackModels = normalizeFallbackModels(fallbackModels, resolvedModel);
  const resolvedMaxCompletionTokens = normalizeMaxCompletionTokens(maxCompletionTokens);
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
        {
          type: "text",
          text: `${promptText(claim, evidence, styleReferences)}\n\nKeep narrative fields and citation excerpts concise. Complete the entire JSON object within the output limit.`,
        },
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
        // Searchable PDF pages are supplied as extracted text. Every image-only
        // PDF page is rendered locally and supplied as a page-labelled vision
        // input so scans inside mixed PDFs are not silently omitted.
        (item.vision_images || []).forEach((pageImage) => {
          userContent.push({
            type: "text",
            text: `[Vision page: ${item.document_name}, page ${pageImage.page}]`,
          });
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${pageImage.mime_type};base64,${pageImage.buffer.toString("base64")}`,
              detail: "high",
            },
          });
        });
      });

      const responseFormat = zodResponseFormat(claimAnalysisSchema, "ula_claim_analysis");
      const compatibilityInstructions = `${SYSTEM_INSTRUCTIONS}\n\nThe selected model does not enforce JSON Schema. Return only one valid JSON object matching this schema exactly; do not use Markdown fences:\n${JSON.stringify(responseFormat.json_schema.schema)}`;
      const requestBase = {
        temperature: 0,
        stream: false,
        max_completion_tokens: resolvedMaxCompletionTokens,
        plugins: [{ id: "response-healing" }],
        transforms: ["middle-out"],
      };
      const attempts = [
        {
          model: resolvedModel,
          ...(resolvedFallbackModels.length ? { models: resolvedFallbackModels } : {}),
        },
        ...(resolvedFallbackModels.length ? [{ model: resolvedFallbackModels[0] }] : []),
      ];

      let response;
      let responseModel = resolvedModel;
      let parsed;
      let lastParseError;
      for (const [attemptIndex, attempt] of attempts.entries()) {
        const candidateModels = attempt.model === resolvedModel ? modelCandidates : [attempt.model];
        let lastRequestError;
        for (const [index, candidateModel] of candidateModels.entries()) {
          try {
            const useJsonObject = requiresJsonObjectCompatibility(candidateModel);
            response = await openai.chat.completions.create({
              ...requestBase,
              ...(index === 0 ? attempt : {}),
              model: candidateModel,
              messages: [
                { role: "system", content: useJsonObject ? compatibilityInstructions : SYSTEM_INSTRUCTIONS },
                { role: "user", content: userContent },
              ],
              response_format: useJsonObject ? { type: "json_object" } : responseFormat,
            });
            responseModel = candidateModel;
            lastRequestError = null;
            break;
          } catch (error) {
            lastRequestError = error;
            if (Number(error?.status) === 404 && index < candidateModels.length - 1) continue;
            if (isRetryableRequestError(error) && attemptIndex < attempts.length - 1) break;
            throw error;
          }
        }
        if (lastRequestError) {
          lastParseError = lastRequestError;
          continue;
        }
        try {
          parsed = parseStructuredAnalysis(response);
          break;
        } catch (error) {
          lastParseError = error;
        }
      }
      if (!parsed) {
        try {
          const content = response?.choices?.[0]?.message?.content;
          parsed = normalizePartialAnalysis(JSON.parse(content || ""));
        } catch {
          throw lastParseError;
        }
      }

      return {
        provider: "openrouter",
        model: response.model || responseModel,
        response_id: response.id || null,
        analyzed_at: new Date().toISOString(),
        analysis: enforceGrounding(parsed, evidence),
      };
    },
  };
}

export {
  evidenceText,
  isRetryableRequestError,
  normalizeFallbackModels,
  normalizeMaxCompletionTokens,
  normalizePartialAnalysis,
  parseStructuredAnalysis,
};
