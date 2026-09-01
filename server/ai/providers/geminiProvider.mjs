import OpenAI from "openai";
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
const DEFAULT_MODEL = "gemini-3.6-flash";

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

      let response;
      try {
        response = await openai.chat.completions.create({
          model: resolvedModel,
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTIONS },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
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
        const rawJson = parseStructuredJson(choice.message.content);
        // Normalize any casing, nulls, or aliased keys
        const normalized = {
          classification: {
            business_line: rawJson?.classification?.business_line || "Other / Requires Review",
            confidence: rawJson?.classification?.confidence ?? 0.9,
            rationale: rawJson?.classification?.rationale || "",
            sources: rawJson?.classification?.sources || [],
          },
          document_types: Array.isArray(rawJson?.document_types || rawJson?.documents)
            ? (rawJson.document_types || rawJson.documents).map((d) => ({
                document_type: d.document_type || "Supporting Evidence",
                confidence: d.confidence ?? 0.95,
                sufficient_information: d.sufficient_information ?? true,
                rationale: d.rationale || "",
                sources: d.sources || [],
              }))
            : [],
          missing_documents: Array.isArray(rawJson?.missing_documents || rawJson?.missing)
            ? (rawJson.missing_documents || rawJson.missing).map((m) => ({
                document_type: m.document_type || "Policy",
                reason: typeof m.reason === "string" ? m.reason : (m?.reason?.reason || "Missing document"),
                missing_information: (m.missing_information || []).map((x) => typeof x === "string" ? x : (x?.field || JSON.stringify(x))),
              }))
            : [],
          fields: Array.isArray(rawJson?.fields)
            ? rawJson.fields.map((f) => ({
                field: f.field || "loss_description",
                value: f.value ?? null,
                normalized_value: f.normalized_value ?? f.value ?? null,
                confidence: f.confidence ?? 0.9,
                requires_confirmation: f.requires_confirmation ?? false,
                sources: f.sources || [],
              }))
            : [],
          adjustment_line_items: Array.isArray(rawJson?.adjustment_line_items || rawJson?.adjustments || rawJson?.line_items)
            ? (rawJson.adjustment_line_items || rawJson.adjustments || rawJson.line_items).map((a) => ({
                description: a.description || "Adjustment",
                quantity: a.quantity ?? null,
                unit_price: a.unit_price ?? null,
                adjusted_value: String(a.adjusted_value ?? "0.00"),
                currency: a.currency || "USD",
                basis: a.basis || "",
                confidence: a.confidence ?? 0.95,
                sources: a.sources || [],
              }))
            : [],
          evidence_findings: Array.isArray(rawJson?.evidence_findings || rawJson?.findings || rawJson?.facts)
            ? (rawJson.evidence_findings || rawJson.findings || rawJson.facts).map((ef) => ({
                finding: typeof ef === "string" ? ef : (ef?.finding || ef?.text || ef?.description || JSON.stringify(ef)),
                confidence: ef.confidence ?? 0.9,
                sources: ef.sources || [],
              }))
            : [],
          summary: typeof rawJson?.summary === "string" ? rawJson.summary : (rawJson?.summary?.summary || rawJson?.summary?.text || ""),
          warnings: Array.isArray(rawJson?.warnings)
            ? rawJson.warnings.map((w) => typeof w === "string" ? w : (w?.warning || w?.message || JSON.stringify(w)))
            : [],
          human_review_required: Array.isArray(rawJson?.human_review_required || rawJson?.review_required)
            ? (rawJson.human_review_required || rawJson.review_required).map((r) => typeof r === "string" ? r : (r?.reason || r?.item || JSON.stringify(r)))
            : [],
        };
        parsed = claimAnalysisSchema.parse(normalized);
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
