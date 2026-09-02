import OpenAI from "openai";
import { BUSINESS_LINES, DOCUMENT_TYPES, claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, parseStructuredJson } from "./openaiProvider.mjs";

/**
 * Gemini provider — uses the OpenAI SDK pointed at Google's OpenAI-compatible endpoint.
 *
 * Key details:
 * - Uses Chat Completions API via Google's compatibility layer.
 * - Uses `response_format` with `json_object` for structured output.
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
        
        const canonicalEnumValue = (val, validList, fallback) => {
          if (!val) return fallback;
          const norm = String(val).toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const item of validList) {
            if (String(item).toLowerCase().replace(/[^a-z0-9]/g, "") === norm) return item;
          }
          return fallback;
        };

        const rawBusinessLine = rawJson?.classification?.business_line || "";
        const matchedBusinessLine = canonicalEnumValue(rawBusinessLine, BUSINESS_LINES, "Other / Requires Review");

        const normalizeSource = (s) => ({
          document_id: String(s?.document_id || ""),
          document_name: String(s?.document_name || ""),
          page: (typeof s?.page === "number" && Number.isInteger(s.page) && s.page > 0) ? s.page : (Number(s?.page) > 0 ? Math.floor(Number(s.page)) : null),
          supporting_text: String(s?.supporting_text || ""),
          confidence: Math.min(1, Math.max(0, Number(s?.confidence) || 0.9)),
          evidence_mode: ["extracted_text", "document_vision", "image_vision"].includes(s?.evidence_mode) ? s.evidence_mode : "extracted_text",
        });

        const normalizedClassification = {
          business_line: matchedBusinessLine,
          confidence: Number(rawJson?.classification?.confidence) || 0.9,
          rationale: String(rawJson?.classification?.rationale || ""),
          sources: (Array.isArray(rawJson?.classification?.sources) ? rawJson.classification.sources : []).map(normalizeSource),
        };

        const rawDocTypes = Array.isArray(rawJson?.document_types || rawJson?.documents)
          ? (rawJson.document_types || rawJson.documents)
          : [];
        const normalizedDocTypes = rawDocTypes.map((d) => {
          const rawType = String(d?.document_type || d || "");
          const matchedType = canonicalEnumValue(rawType, DOCUMENT_TYPES, "Supporting Evidence");
          return {
            document_type: matchedType,
            confidence: Number(d?.confidence) || 0.95,
            sufficient_information: d?.sufficient_information ?? true,
            rationale: String(d?.rationale || ""),
            sources: (Array.isArray(d?.sources) ? d.sources : []).map(normalizeSource),
          };
        });

        const rawMissing = Array.isArray(rawJson?.missing_documents || rawJson?.missing)
          ? (rawJson.missing_documents || rawJson.missing)
          : [];
        const normalizedMissing = rawMissing.map((m) => {
          const rawType = typeof m === "string" ? m : String(m?.document_type || "Policy");
          const matchedType = canonicalEnumValue(rawType, DOCUMENT_TYPES, "Policy");
          const rawReason = typeof m?.reason === "string" ? m.reason : (m?.reason?.reason || "Missing document");
          const rawMissingInfo = Array.isArray(m?.missing_information) ? m.missing_information : [];
          return {
            document_type: matchedType,
            reason: String(rawReason),
            missing_information: rawMissingInfo.map((x) => typeof x === "string" ? x : (x?.field || JSON.stringify(x))),
          };
        });

        const stringOrNull = (v) => (v === null || v === undefined ? null : String(v));

        const rawFields = Array.isArray(rawJson?.fields) ? rawJson.fields : [];
        const normalizedFields = rawFields.map((f) => ({
          field: f?.field || "loss_description",
          value: stringOrNull(f?.value),
          normalized_value: stringOrNull(f?.normalized_value ?? f?.value),
          confidence: Number(f?.confidence) || 0.9,
          requires_confirmation: f?.requires_confirmation ?? false,
          sources: (Array.isArray(f?.sources) ? f.sources : []).map(normalizeSource),
        }));

        const rawAdjustments = Array.isArray(rawJson?.adjustment_line_items || rawJson?.adjustments || rawJson?.line_items)
          ? (rawJson.adjustment_line_items || rawJson.adjustments || rawJson.line_items)
          : [];
        const normalizedAdjustments = rawAdjustments.map((a) => ({
          description: String(a?.description || "Adjustment"),
          quantity: stringOrNull(a?.quantity),
          unit_price: stringOrNull(a?.unit_price),
          adjusted_value: String(a?.adjusted_value ?? "0.00"),
          currency: stringOrNull(a?.currency || "USD"),
          basis: String(a?.basis || ""),
          confidence: Number(a?.confidence) || 0.95,
          sources: (Array.isArray(a?.sources) ? a.sources : []).map(normalizeSource),
        }));

        const rawFindings = Array.isArray(rawJson?.evidence_findings || rawJson?.findings || rawJson?.facts)
          ? (rawJson.evidence_findings || rawJson.findings || rawJson.facts)
          : [];
        const normalizedFindings = rawFindings.map((ef) => ({
          finding: typeof ef === "string" ? ef : (ef?.finding || ef?.text || ef?.description || JSON.stringify(ef)),
          confidence: Number(ef?.confidence) || 0.9,
          sources: (Array.isArray(ef?.sources) ? ef.sources : []).map(normalizeSource),
        }));

        const normalized = {
          classification: normalizedClassification,
          document_types: normalizedDocTypes,
          missing_documents: normalizedMissing,
          fields: normalizedFields,
          adjustment_line_items: normalizedAdjustments,
          evidence_findings: normalizedFindings,
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
        analysis: enforceGrounding(parsed, evidence, styleReferences),
      };
    },
  };
}
