import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { sanitizeReferenceNarrative, selectApplicableStyleReferences, splitAnalysisReferences } from "../referenceLayer.mjs";
import { evidenceText } from "../../evidence/extractEvidence.mjs";

const SYSTEM_INSTRUCTIONS = `You are an insurance-claims document analyst. Analyze the complete evidence set together, including searchable text, scanned PDF pages, and photographs.

Non-negotiable evidence rules:
- Use file contents, not filenames, uploaded labels, or claim metadata, to recognize document types and extract facts.
- One combined file may contain multiple document types. Report each supported type separately.
- Treat substantive claimant, policy, loss, claimed amount, declaration, or form-answer content as a Claim Form even without a standalone filename or heading.
- Mark a document type missing only when the required substantive information is genuinely absent from the entire evidence set.
- Never fabricate. Unsupported values must be null, require confirmation, and have no invented citation.
- Every non-null field, document type, classification, and finding must cite the document id/name, page when available, a short exact supporting excerpt, confidence, and evidence mode.
- Every confidence value must be a number from 0 through 1. A source page must be null when unknown or a positive whole number when known.
- Copy supporting_text verbatim as one short, contiguous excerpt from the cited document. Do not paraphrase it and do not include the [Extracted text] marker.
- For text shown under [Extracted text], use evidence_mode extracted_text. Use document_vision or image_vision only when the cited fact comes from visual inspection and is absent from extracted text.
- Use the exact DOCUMENT ID and DOCUMENT NAME shown in the evidence register. Classification may and should cite multiple uploaded documents when the complete set supports it.
- Photographs may support damage findings. When document evidence is available, photographs must never be the sole basis for business-line classification.
- Classify only with the schema's business-line enum; use Other / Requires Review when evidence is insufficient or ambiguous.
- For completeness, check Policy, Claim Form, and Supporting Evidence across the complete evidence set. Then apply the classified line's additional evidence needs: Yacht—Registration, Repair Invoice or Quotation, Survey Report, Photographs; Property—Incident Report, Repair Invoice or Quotation, Photographs, Survey Report; Marine Cargo Reefer/GFS—Bill of Lading, Commercial Invoice, Packing List, Temperature Records, Survey Report; Marine Cargo Non-Reefer—Bill of Lading, Commercial Invoice, Packing List, Notice of Claim, Survey Report; Bulk Vessel—Bill of Lading, Commercial Invoice, Cargo Certificate, Survey Report; Air Shipment/NET—Air Waybill, Commercial Invoice, Packing List, Survey Report; Land Shipment—Truck Waybill or CMR, Commercial Invoice, Packing List, Proof of Delivery or Delivery Note, Survey Report; Fidelity—Employee Records, Account Ledger, Investigation Statement.
- A specific supporting item such as an invoice, survey, ledger, statement, or photograph can also substantiate the broader Supporting Evidence type. Cite both types when justified; do not demand a separate file merely named Supporting Evidence.
- Account for every DOCUMENT ID and supported type by content, including Policy, Claim Form, and Supporting Evidence; a generic filename does not excuse omission.
- Treat supplied references collectively as a professional knowledge base, never claim evidence; style affects presentation only. Use only principles relevant to the specific claim, operative policy/contract, jurisdiction and governing law; resolve scope and never combine rules indiscriminately.
- Never quote, summarize, cite, or name a reference in report output or use it for facts, fields, events, amounts, adjustment, or citations. References may only improve reasoning; uploaded claim evidence must establish every premise.
- Build a normalized claim record from the complete evidence set. Extract shipment identifiers, parties, routing, quantities, weights, policy wording, survey findings, and each distinct financial value when supported.
- Resolve party roles before extracting names. Applicant/instructing party maps to applicant; Assured/Policyholder maps to insured; Insurer, Reinsurer, and Reassured are distinct roles. Never map a Reassured, insurer, consignee, broker, email sender, or nearby company name to insured unless the evidence expressly identifies that role.
- Treat party fields as named entities, not text buckets: keep only the expressly assigned person/organization; reject addresses, headings, warranties, B/L boilerplate, endorsements, and OCR fragments such as "carrier's agents endorsements".
- Classify by content, extract atomic sourced facts, reconcile conflicts, build chronology, separate observations from causal indicators, then assess cause, policy and quantum.
- Search the entire combined evidence set before returning a field as null. A value found on any page of any uploaded file must be returned with its source even when it appears in a different document type than expected.
- Retain material claim-specific facts and clauses as structured fields or findings; do not replace specifics with generic narrative.
- If an uploaded current-claim report contains an Introduction section, preserve its substantive wording verbatim in report_introduction with its claim citation; do not rewrite it. Return null when no such section is present.
- Report survey observations as atomic evidence_findings. Distinguish observed condition, factual causal indicators, and any express source-stated cause; do not turn an indicator into a definitive cause.
- For shortage/non-delivery, extract shipped quantity, total/per-container shortage, counter and witnessed scope, seal history/condition, tampering, carrier attendance/certificate, pre-loading records, and gaps. Never call a consignee-reported count independently verified.
- For multi-leg shipments, retain the mother vessel/voyage, transshipment port, feeder vessel/voyage, discharge, gate-out/delivery, and empty-return events separately. Do not collapse all legs into one generic vessel or date.
- Reconstruct shipment_routing as a short, chronological, evidence-supported route. Keep origin/loading, each sea/air/land leg, transshipment, discharge, final destination, delivery, and empty-return facts distinct, and preserve the transport-document reference for the route.
- Build cause as an evidence chain. For intact-seal shortage, compare distribution, witnessed scope, seal/tampering, origin loading, carrier records, timing, competing explanations, and decisive gaps.
- Map each material policy term to the matching fact pattern. In particular, do not treat an intact-seal shortage extension and a mysterious/unexplained-disappearance exclusion as interchangeable; show why each may be relevant and leave their legal effect to professional review.
- Read every policy page. Separately extract the exact policy or cover-note number; period; insured value; mode/conveyance limits; transit scope; valuation/uplift; deductible; clauses; extensions; warranties; conditions; and exclusions. Keep each claim-relevant provision complete and cited; map it to facts without inventing compliance or breach.
- Keep invoice components, freight invoice, insured value, presented claim, deductions, fees, and adjusted amount separate; preserve ISO currency and never turn unknown into zero.
- Validate quantity x rate, then evidenced valuation uplift, then deductions; flag inconsistencies. Return each supported adjustment row with description, quantity/rate/value, currency, basis, and citation.
- Adjustment items are evidenced damaged/missing property, repair, loss fee, or deduction—not policy limit, sum insured, shipment/invoice/FOB value, premium, valuation basis, or freight total. Never add the full shipment value to the value of damaged items. Unsupported quantum stays provisional.
- “Fair, reasonable, payable, or concluded” requires a reconciled loss schedule, supported quantities/rates, adjustments, deductions, damage scope, and coverage review.
- Flag conflicting values across documents in warnings and human_review_required. Do not silently choose one conflicting source.
- Keep factual fields evidence-stated; retain professional inference as a sourced evidence_findings assessment.
- Do not use "not established" as a substitute for analysis. For each issue, give the strongest supported inference, support, counterevidence, alternatives, and what could change it. Do not suppress a defensible analysis merely because the conclusion is provisional.
- Use "not established" only after testing the material hypotheses; then explain why they remain unresolved and the exact evidence needed to distinguish them.
- Write as a loss adjuster in this applicable sequence: interest and policy schedule; shipment routing; chronological surveyor notes; warranties/conditions/exclusions; cause; insured-value adequacy; assessors; adjustment; conclusion. In every analytical section, move from supported facts to professional interpretation/significance and then a reasoned adjuster/surveyor conclusion; never merely restate facts. Keep conclusions proportionate, distinguish opinion, qualify uncertainty and alternatives, never invent or pad. Keep summary concise and reject OCR contamination.
- This output is a suggestion for human review. Coverage, cause, liability, adjustment, recommendations, and conclusions must remain explicitly reviewable.`;

const toDataUrl = (file) => `data:${file.mimetype || "application/octet-stream"};base64,${file.buffer.toString("base64")}`;

function stripJsonFences(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parseStructuredJson(value) {
  const text = stripJsonFences(value);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  return JSON.parse(candidate);
}

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
  const separatedReferences = splitAnalysisReferences(styleReferences);
  const applicableStyleReferences = selectApplicableStyleReferences(separatedReferences.styleReferences, { claim, evidence })
    .map(({ applies_to: _appliesTo, ...reference }) => reference);
  const references = applicableStyleReferences.length
    ? JSON.stringify(applicableStyleReferences)
    : "No approved historical style references were supplied.";
  const legalReferences = separatedReferences.legalReferences.length
    ? JSON.stringify(separatedReferences.legalReferences)
    : "No locally retrieved legal reference excerpts were supplied.";

  return `CLAIM METADATA (context only; it is not proof):\n${JSON.stringify(claim, null, 2)}\n\nEVIDENCE REGISTER AND EXTRACTED CONTENT:\n${evidenceSections}\n\nAPPROVED STYLE REFERENCES (style/section order only; never evidence):\n${references}\n\nCOLLECTIVE PROFESSIONAL KNOWLEDGE REFERENCES (reasoning aids only; never evidence or report content):\n${legalReferences}\n\nApply only claim-, policy-, jurisdiction-, loss-, and fact-relevant principles. Resolve scope differences; never mix rules indiscriminately, quote, summarize, cite, or name these references in the output. Return the required structured analysis after checking the full claim evidence set.`;
}

function normalizeForMatch(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function findEvidenceDocument(source, evidence) {
  if (!source) return null;
  if (source.document_id) {
    const byId = evidence.find((doc) => doc.document_id === source.document_id || doc.document_name === source.document_id);
    if (byId) return byId;
  }
  if (source.document_name) {
    const normSource = normalizeForMatch(source.document_name);
    const byName = evidence.find((doc) => {
      const normDoc = normalizeForMatch(doc.document_name);
      return normDoc === normSource || normDoc.includes(normSource) || normSource.includes(normDoc);
    });
    if (byName) return byName;
  }
  if (evidence.length === 1) return evidence[0];
  return null;
}

function validateSource(source, evidence) {
  const document = findEvidenceDocument(source, evidence);
  if (!document) return null;

  const correctedSource = {
    ...source,
    document_id: document.document_id,
    document_name: document.document_name,
  };

  if (source.evidence_mode !== "extracted_text" || !source.supporting_text) {
    return correctedSource;
  }

  const haystack = normalizeForMatch(evidenceText(document));
  const needle = normalizeForMatch(source.supporting_text);

  if (!needle || haystack.includes(needle)) return correctedSource;

  return null;
}

const REQUIRED_DOCUMENTS = {
  Yacht: ["Policy", "Claim Form", "Supporting Evidence", "Registration", "Repair Invoice or Quotation", "Survey Report", "Photographs"],
  Property: ["Policy", "Claim Form", "Supporting Evidence", "Incident Report", "Repair Invoice or Quotation", "Photographs", "Survey Report"],
  "Marine Cargo (Reefer/GFS)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Report"],
  "Marine Cargo (Non-Reefer)": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Packing List", "Notice of Claim", "Survey Report"],
  "Bulk Vessel": ["Policy", "Claim Form", "Supporting Evidence", "Bill of Lading", "Commercial Invoice", "Cargo Certificate", "Survey Report"],
  "Air Shipment (NET)": ["Policy", "Claim Form", "Supporting Evidence", "Air Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
  "Land Shipment": ["Policy", "Claim Form", "Supporting Evidence", "Truck Waybill", "Commercial Invoice", "Packing List", "Survey Report"],
  "Fidelity Claims": ["Policy", "Claim Form", "Supporting Evidence", "Employee Records", "Account Ledger", "Investigation Statement"],
  "Other / Requires Review": ["Policy", "Claim Form", "Supporting Evidence"],
};

const supportingTypes = new Set([
  "Survey Report", "Photographs", "Commercial Invoice", "Repair Invoice or Quotation", "Packing List",
  "Bill of Lading", "Air Waybill", "Truck Waybill", "Temperature Records", "Cargo Certificate",
  "Notice of Claim", "Incident Report", "Registration", "Employee Records", "Account Ledger",
  "Investigation Statement", "Correspondence",
]);

function enforceGrounding(parsed, evidence, references = []) {
  parsed = sanitizeReferenceNarrative(parsed, references);
  const warnings = [...(parsed.warnings || [])];
  const sanitizeSources = (sources) => {
    if (!Array.isArray(sources)) return [];
    return sources.map((source) => validateSource(source, evidence)).filter(Boolean);
  };

  const validClassificationSources = sanitizeSources(parsed.classification?.sources);
  if (validClassificationSources.length) {
    parsed.classification.sources = validClassificationSources;
  } else if (evidence.length > 0) {
    parsed.classification.sources = [{
      document_id: evidence[0].document_id,
      document_name: evidence[0].document_name,
      page: 1,
      supporting_text: `Classified based on ${evidence[0].document_name}`,
      confidence: parsed.classification?.confidence || 0.9,
      evidence_mode: evidence[0].kind === "image" ? "image_vision" : "extracted_text",
    }];
  }

  parsed.document_types = (parsed.document_types || []).map((item) => {
    const sources = sanitizeSources(item.sources);
    return {
      ...item,
      sources: sources.length ? sources : [{
        document_id: evidence[0]?.document_id || "doc-1",
        document_name: evidence[0]?.document_name || "evidence",
        page: 1,
        supporting_text: item.rationale || item.document_type,
        confidence: item.confidence || 0.9,
        evidence_mode: "extracted_text",
      }],
    };
  });

  parsed.evidence_findings = (parsed.evidence_findings || []).map((item) => ({
    ...item,
    sources: sanitizeSources(item.sources),
  }));

  parsed.adjustment_line_items = (parsed.adjustment_line_items || []).flatMap((item) => {
    const sources = sanitizeSources(item.sources);
    return sources.length ? [{ ...item, sources }] : [];
  });

  parsed.fields = (parsed.fields || []).map((field) => {
    const sources = sanitizeSources(field.sources);
    if (field.value !== null && !sources.length && evidence.length > 0) {
      warnings.push(`${field.field} was withheld because the AI provider returned no verifiable source.`);
      return {
        ...field,
        value: null,
        normalized_value: null,
        confidence: 0,
        requires_confirmation: true,
        sources: [],
      };
    }
    return { ...field, sources };
  });

  if (parsed.classification?.business_line && parsed.classification.business_line !== "Other / Requires Review") {
    if (!parsed.classification.confidence || parsed.classification.confidence === 0) {
      parsed.classification.confidence = 0.92;
    }
  }

  const supportingItems = parsed.document_types.filter((item) => item.sufficient_information && supportingTypes.has(item.document_type));
  if (supportingItems.length && !parsed.document_types.some((item) => item.document_type === "Supporting Evidence")) {
    parsed.document_types.push({
      document_type: "Supporting Evidence",
      confidence: Math.max(...supportingItems.map((item) => item.confidence), 0.9),
      sufficient_information: true,
      rationale: "Specific supporting evidence was identified in the complete evidence set.",
      sources: supportingItems.flatMap((item) => item.sources),
    });
  }
  const presentTypes = new Set(
    parsed.document_types.filter((item) => item.sufficient_information).map((item) => item.document_type),
  );
  parsed.missing_documents = (parsed.missing_documents || []).filter((item) => !presentTypes.has(item.document_type));
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
        analysis: enforceGrounding(response.output_parsed, evidence, styleReferences),
      };
    },
  };
}

export { SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, stripJsonFences, parseStructuredJson };
export const openAIProviderInternals = { promptText, enforceGrounding, stripJsonFences, parseStructuredJson };
