import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { evidenceText } from "../../evidence/extractEvidence.mjs";

const SYSTEM_INSTRUCTIONS = `You are an insurance-claims document analyst. Analyze the complete evidence set together, including searchable text, scanned PDF pages, and photographs.

Non-negotiable evidence rules:
- Use file contents, not filenames, uploaded labels, or claim metadata, to recognize document types and extract facts.
- One combined file may contain multiple document types. Report each supported type separately.
- A Claim Form is present when the evidence contains substantive claim-form information such as claimant/insured identity, policy or claim reference, loss date/circumstances, claimed loss, declaration, signature, or form questions and answers. It need not have a standalone filename or heading.
- Mark a document type missing only when the required substantive information is genuinely absent from the entire evidence set.
- Never fabricate. Unsupported values must be null, require confirmation, and have no invented citation.
- Every non-null field, document type, classification, and finding must cite the document id/name, page when available, a short exact supporting excerpt, confidence, and evidence mode.
- Photographs may support damage findings. When document evidence is available, photographs must never be the sole basis for business-line classification.
- Classify only as Yacht, Property, Marine Cargo (Reefer/GFS), Marine Cargo (Non-Reefer), Bulk Vessel, Air Shipment (NET), Fidelity Claims, or Other / Requires Review. Use Other / Requires Review when evidence is insufficient or ambiguous.
- For completeness, check Policy, Claim Form, and Supporting Evidence across the complete evidence set. Then apply the classified line's additional evidence needs: Yacht—Registration, Repair Invoice or Quotation, Survey Report, Photographs; Property—Incident Report, Repair Invoice or Quotation, Photographs, Survey Report; Marine Cargo Reefer/GFS—Bill of Lading, Commercial Invoice, Packing List, Temperature Records, Survey Report; Marine Cargo Non-Reefer—Bill of Lading, Commercial Invoice, Packing List, Notice of Claim, Survey Report; Bulk Vessel—Bill of Lading, Commercial Invoice, Cargo Certificate, Survey Report; Air Shipment/NET—Air Waybill, Commercial Invoice, Packing List, Survey Report; Fidelity—Employee Records, Account Ledger, Investigation Statement.
- A specific supporting item such as an invoice, survey, ledger, statement, or photograph can also substantiate the broader Supporting Evidence type. Cite both types when justified; do not demand a separate file merely named Supporting Evidence.
- Historical style references are not claim evidence. Never extract names, amounts, dates, facts, or conclusions from them.
- This output is a suggestion for human review. Coverage, cause, liability, adjustment, recommendations, and conclusions must remain explicitly reviewable.`;

const toDataUrl = (file) => `data:${file.mimetype || "application/octet-stream"};base64,${file.buffer.toString("base64")}`;

function promptText(claim, evidence, styleReferences) {
  const evidenceSections = evidence.map((item) => {
    const text = evidenceText(item);
    return [
      `DOCUMENT ID: ${item.document_id}`,
      `DOCUMENT NAME: ${item.document_name}`,
      `MIME TYPE: ${item.mime_type}`,
      `LOCAL EXTRACTION STATUS: ${item.extraction_status}`,
      text || "[No searchable text was extracted. Inspect the attached PDF/image visually.]",
    ].join("\n");
  }).join("\n\n--- END DOCUMENT ---\n\n");
  const references = styleReferences.length
    ? JSON.stringify(styleReferences)
    : "No approved historical style references were supplied.";

  return `CLAIM METADATA (context only; it is not proof):\n${JSON.stringify(claim, null, 2)}\n\nEVIDENCE REGISTER AND EXTRACTED CONTENT:\n${evidenceSections}\n\nAPPROVED STYLE REFERENCES (style/section order only; never evidence):\n${references}\n\nReturn the required structured analysis. Check the full evidence set before declaring information or a document type missing.`;
}

function normalizeForMatch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function validateSource(source, evidenceById) {
  const document = evidenceById.get(source.document_id);
  if (!document || document.document_name !== source.document_name) return false;
  if (source.evidence_mode !== "extracted_text") return true;
  const haystack = normalizeForMatch(evidenceText(document));
  const needle = normalizeForMatch(source.supporting_text);
  return Boolean(needle && haystack.includes(needle));
}

const REQUIRED_DOCUMENTS = {
  Yacht: ["Policy", "Claim Form", "Supporting Evidence", "Registration", "Repair Invoice or Quotation", "Survey Report", "Photographs"],
  Property: ["Policy", "Claim Form", "Supporting Evidence", "Incident Report", "Repair Invoice or Quotation", "Photographs", "Survey Report"],
  "Marine Cargo (Reefer/GFS)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Report"],
  "Marine Cargo (Non-Reefer)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Notice of Claim", "Survey Report"],
  "Bulk Vessel": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Cargo Certificate", "Survey Report"],
  "Air Shipment (NET)": ["Policy", "Claim Form", "Supporting Evidence", "Air Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
  "Fidelity Claims": ["Policy", "Claim Form", "Supporting Evidence", "Employee Records", "Account Ledger", "Investigation Statement"],
  "Other / Requires Review": ["Policy", "Claim Form", "Supporting Evidence"],
};

const supportingTypes = new Set([
  "Survey Report", "Photographs", "Commercial Invoice", "Repair Invoice or Quotation", "Packing List",
  "Bill of Lading", "Air Waybill", "Truck Waybill", "Temperature Records", "Cargo Certificate",
  "Notice of Claim", "Incident Report", "Registration", "Employee Records", "Account Ledger",
  "Investigation Statement", "Correspondence",
]);

function enforceGrounding(parsed, evidence) {
  const evidenceById = new Map(evidence.map((item) => [item.document_id, item]));
  const warnings = [...parsed.warnings];
  const sanitizeSources = (sources) => sources.filter((source) => {
    const valid = validateSource(source, evidenceById);
    if (!valid) warnings.push(`A citation for ${source.document_name} could not be verified and was removed.`);
    return valid;
  });

  parsed.classification.sources = sanitizeSources(parsed.classification.sources);
  parsed.document_types = parsed.document_types.map((item) => ({ ...item, sources: sanitizeSources(item.sources) })).filter((item) => {
    if (item.sources.length) return true;
    warnings.push(`The proposed ${item.document_type} document type had no verifiable source and was removed.`);
    return false;
  });
  parsed.evidence_findings = parsed.evidence_findings.map((item) => ({ ...item, sources: sanitizeSources(item.sources) }));
  parsed.fields = parsed.fields.map((field) => {
    const sources = sanitizeSources(field.sources);
    if (field.value !== null && !sources.length) {
      warnings.push(`The suggested ${field.field} value had no verifiable source and was changed to Requires confirmation.`);
      return { ...field, value: null, normalized_value: null, confidence: 0, requires_confirmation: true, sources: [] };
    }
    return { ...field, sources };
  });

  const documentEvidenceExists = evidence.some((item) => item.kind !== "image" && item.kind !== "unsupported" && item.kind !== "unreadable");
  const classificationUsesDocument = parsed.classification.sources.some((source) => source.evidence_mode !== "image_vision");
  if (!parsed.classification.sources.length || (documentEvidenceExists && !classificationUsesDocument)) {
    parsed.classification = {
      business_line: "Other / Requires Review",
      confidence: 0,
      rationale: "The proposed classification did not contain a verifiable non-photographic evidence citation.",
      sources: [],
    };
    warnings.push("Business-line classification requires review because it was not grounded in document evidence.");
  }

  const supportingItems = parsed.document_types.filter((item) => item.sufficient_information && supportingTypes.has(item.document_type));
  if (supportingItems.length && !parsed.document_types.some((item) => item.document_type === "Supporting Evidence")) {
    parsed.document_types.push({
      document_type: "Supporting Evidence",
      confidence: Math.max(...supportingItems.map((item) => item.confidence)),
      sufficient_information: true,
      rationale: "Specific supporting evidence was identified in the complete evidence set.",
      sources: supportingItems.flatMap((item) => item.sources),
    });
  }
  const presentTypes = new Set(
    parsed.document_types.filter((item) => item.sufficient_information).map((item) => item.document_type),
  );
  parsed.missing_documents = parsed.missing_documents.filter((item) => !presentTypes.has(item.document_type));
  const missingTypes = new Set(parsed.missing_documents.map((item) => item.document_type));
  for (const required of REQUIRED_DOCUMENTS[parsed.classification.business_line] || REQUIRED_DOCUMENTS["Other / Requires Review"]) {
    if (presentTypes.has(required) || missingTypes.has(required)) continue;
    parsed.missing_documents.push({
      document_type: required,
      reason: `The complete evidence analysis did not identify sufficient substantive ${required} information.`,
      missing_information: [`Substantive ${required} content requires confirmation.`],
    });
  }
  parsed.warnings = [...new Set(warnings)];
  return parsed;
}

export function createOpenAIProvider({ apiKey, model, client } = {}) {
  const resolvedModel = model || "gpt-5.6-terra";
  const openai = client || new OpenAI({ apiKey });
  return {
    name: "openai",
    model: resolvedModel,
    async analyze({ claim, evidence, files, styleReferences = [] }) {
      const content = [{ type: "input_text", text: promptText(claim, evidence, styleReferences) }];
      evidence.forEach((item, index) => {
        const file = files[index];
        if (!file) return;
        if (item.kind === "pdf") {
          content.push({ type: "input_file", filename: item.document_name, file_data: toDataUrl(file), detail: "auto" });
        } else if (item.kind === "image") {
          content.push({ type: "input_image", image_url: toDataUrl(file), detail: "high" });
        } else if (["document", "spreadsheet", "text"].includes(item.kind)) {
          content.push({ type: "input_file", filename: item.document_name, file_data: toDataUrl(file) });
        }
        (item.embedded_images || []).forEach((embedded) => content.push({
          type: "input_image",
          image_url: `data:${embedded.mime_type};base64,${embedded.buffer.toString("base64")}`,
          detail: "high",
        }));
      });

      const response = await openai.responses.parse({
        model: resolvedModel,
        store: false,
        safety_identifier: `ula_claim_${String(claim.id || "unknown")}`,
        instructions: SYSTEM_INSTRUCTIONS,
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(claimAnalysisSchema, "ula_claim_analysis") },
      });
      if (!response.output_parsed) throw new Error("The AI provider returned no structured analysis.");
      return {
        provider: "openai",
        model: resolvedModel,
        response_id: response.id,
        analyzed_at: new Date().toISOString(),
        analysis: enforceGrounding(response.output_parsed, evidence),
      };
    },
  };
}

export { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding };
export const openAIProviderInternals = { promptText, enforceGrounding };
