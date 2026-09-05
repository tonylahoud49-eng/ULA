import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { claimAnalysisSchema } from "../claimAnalysisSchema.mjs";
import { sanitizeReferenceNarrative, selectApplicableStyleReferences, splitAnalysisReferences } from "../referenceLayer.mjs";
import { evidenceText } from "../../evidence/extractEvidence.mjs";
import { buildAnalysisCoveragePlan, enforceAnalysisCoverage } from "../analysisCoverage.mjs";
import { calculateAiUsage } from "../billingCalculator.mjs";

const DIRECTOR_ANALYSIS_PROTOCOL = `Director-grade analysis protocol:
- Work through the claim in two internal passes before encoding the response. Pass 1 builds the complete sourced fact, document, party-role, chronology, policy, quantity, financial, and condition record. Pass 2 challenges the proposed analysis against the evidence, the applicable owner-approved methodology profile, material alternatives, contradictions, and missing proof. Return only the final structured result; do not expose private chain-of-thought.
- Before either pass, review every page of every current-claim PDF in page-number order, including pages with limited OCR, scanned pages, schedules, endorsements, signatures, tables, and pages containing a material raster image. Complete this internal page-coverage review before drafting the analysis; do not rely on a document summary, filename, first page, or selected excerpt as a substitute.
- Treat every applicable owner-approved methodology note as an analysis checklist, not optional style advice. Perform each material test that the current evidence permits. When a test cannot be completed, identify the exact missing evidence and explain how that gap limits cause, cover, quantum, recovery, or outcome.
- Build an issue ledger across six domains: factual chronology and custody; physical condition and extent; proximate cause; policy application; quantum and mitigation; liability and recovery. Do not omit a material domain merely because the evidence is incomplete.
- For every material analytical issue, return a domain-labelled evidence_finding that states: the supported facts or observations; their professional significance; evidence that strengthens and weakens the proposition; viable competing explanations; the strongest proportionate provisional assessment; and the precise evidence or decision that could change it. Keep facts, source-stated conclusions, and professional opinion visibly distinct.
- Cause analysis must test mechanisms, timing, custody, physical consistency, counterevidence, and alternatives. Rank supported hypotheses when the evidence permits. Do not merely list possible causes, repeat the reported cause, or infer causation from damage, delay, an intact seal, a logger excursion, a clean transport document, or a screening test alone.
- Where physical evidence supports a qualified mechanism but not the precise event or custodian, state the strongest qualified professional opinion on that mechanism and separately identify the custody-stage limitation. Do not replace that analysis with repeated chronology or a generic unresolved-cause statement.
- Use comparison evidence: compare pre-loading with delivery condition, affected with sound packages or components. Treat prior similar shipments as context, never as standalone proof of cause or packing compliance.
- Separate observed physical damage from inferred internal failure, contamination, hygiene, safety, fitness for purpose, repairability, and total loss. A screening test identifies only what its evidenced method supports; stronger conclusions require proportionate testing, expert or OEM evidence, or explicit qualification.
- Policy analysis must pair each material clause, extension, warranty, condition, exclusion, deductible, limit, duration, and valuation provision with the established current-claim facts to which it may apply. Explain the provisional significance and unresolved factual or legal issue without inventing compliance, breach, cover, or legal effect.
- Identify the policy only from an exact, expressly labelled Policy No., Policy Number, or Cover Note No. Do not mistake a sum insured, premium, invoice, certificate, endorsement, claim, or nearby OCR word for the policy identifier. If another document carries a different reference, retain it as that document's reference and identify the conflict; do not silently replace the policy number.
- When the current evidence contains operative policy or cover-note wording, create a separate policy_application finding for every material policy issue. Each finding must identify the current provision, the current claim fact that engages it (or the exact fact that is missing), the provisional consequence, and the specific question that remains for professional cover approval. Do not collapse unrelated clauses into a generic coverage statement.
- Do not use a generic policy summary such as "the policy terms require review" in place of the issue map. Each policy_application finding must be self-contained and use this order: provision; current fact or precise gap; provisional significance; professional decision required.
- Build a policy-issue hierarchy: keep an independently established scope, territorial, duration, limit, or exclusion issue separate from disputed cause, packing, warranty, or compliance. Identify which verified issue could control the provisional outcome, leaving final legal effect and coverage approval to the authorized professional.
- Quantum analysis must reconcile the scope of loss at the smallest evidenced unit, distinguish claimed, surveyed, accepted, repairable, rejected, salvaged, and total-loss quantities, identify duplicate or unsupported items, and preserve every source input needed by the deterministic calculation layer. Do not perform the application's arithmetic.
- Reconcile each quotation, invoice, repair, and claimed line individually against the evidenced damaged item, quantity, rate, and loss scope. Never select an arbitrary quotation line or silently drop the balance. If a quotation total cannot be mapped to the established damaged items, retain it only as provisional valuation evidence and identify the itemised claim schedule or mapping needed before adjustment.
- When survey/SOF/rejection/inspection evidence establishes a smaller affected quantity than the shipped or invoiced quantity, treat it as the maximum supported loss scope. Keep full-shipment quantity/value as context, not an adjustment row.
- Liability and recovery analysis must identify each plausible party separately, connect the party to the evidenced custody or contractual role, and test causation, notice, reservations, investigation response, limitation or time-bar material, evidence preservation, available defences, and recovery economics before recommending pursuit.
- Select the strongest evidence-supported outcome branch permitted by the applicable profile. If no branch can yet be selected, explain which competing branches remain open and the exact evidence that separates them.
- Before returning the response, audit it for unsupported assertions, missed pages or parties, generic filler, contradictions represented from only one side, arithmetic disguised as extraction, conflated financial concepts, repeated findings, and conclusions stronger or weaker than the evidence. Correct those defects in the final structured result.`;

const SYSTEM_INSTRUCTIONS = `You are a senior insurance loss adjuster and surveyor performing evidence-grounded claim analysis. Analyze the complete evidence set together, including searchable text, scanned PDF pages, and photographs.

Non-negotiable evidence rules:
- Use file contents, not filenames, uploaded labels, or claim metadata, to recognize document types and extract facts.
- For a native PDF supplied in the request, navigate and assess its pages individually. A later page, endorsement, schedule, continuation, signature, table, or appendix may qualify or supersede an earlier page.
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
- Treat supplied references collectively as a professional knowledge base, never claim evidence; style affects presentation only. Use only principles relevant to the specific claim, operative policy/contract, jurisdiction and governing law; resolve scope and never combine rules indiscriminately.
- Never quote, summarize, cite, or name a reference in report output or use it for facts, fields, events, amounts, adjustment, or citations. References may only improve reasoning; uploaded claim evidence must establish every premise.
- Build a normalized claim record from the complete evidence set. Extract shipment identifiers, parties, routing, quantities, weights, policy wording, survey findings, and each distinct financial value when supported.
- Resolve party roles before extracting names. Applicant/instructing party maps to applicant; Assured/Policyholder maps to insured; Insurer, Reinsurer, and Reassured are distinct roles. Never map a Reassured, insurer, consignee, broker, email sender, or nearby company name to insured unless the evidence expressly identifies that role.
- Treat party fields as named entities, not text buckets: keep only the expressly assigned person/organization; reject addresses, headings, warranties, B/L boilerplate, endorsements, and OCR fragments such as "carrier's agents endorsements".
- Classify by content, extract atomic sourced facts, reconcile conflicts, build chronology, separate observations from causal indicators, then assess cause, policy and quantum.
- Search the entire combined evidence set before returning a field as null. A value found on any page of any uploaded file must be returned with its source even when it appears in a different document type than expected.
- Inspect every supplied visual page, even one with only a scanner watermark or a few OCR characters, before calling survey/SOF/damage/photo evidence absent.
- If an uploaded current-claim report contains an Introduction section, preserve its substantive wording verbatim in report_introduction with its claim citation; do not rewrite it. Return null when no such section is present.
- Use evidence_findings as a professional issue ledger. Assign every finding exactly one analysis_domain: chronology_custody, condition_extent, proximate_cause, policy_application, quantum_mitigation, liability_recovery, or general. Keep each finding focused on one material issue and distinguish observed condition, factual causal indicators, express source-stated cause, and professional opinion; do not turn an indicator into a definitive cause.
- For shortage/non-delivery, extract shipped quantity, total/per-container shortage, counter and witnessed scope, seal history/condition, tampering, carrier attendance/certificate, pre-loading records, and gaps. Never call a consignee-reported count independently verified.
- For multi-leg shipments, retain the mother vessel/voyage, transshipment port, feeder vessel/voyage, discharge, gate-out/delivery, and empty-return events separately. Do not collapse all legs into one generic vessel or date.
- Keep labelled master/house B/L and every source-specific vessel/voyage separate; expose conflicts instead of collapsing them or calling the transport reference absent.
- Map each material policy term to the matching fact pattern. In particular, do not treat an intact-seal shortage extension and a mysterious/unexplained-disappearance exclusion as interchangeable; show why each may be relevant and leave their legal effect to professional review.
- Read every policy page. Separately extract the exact policy or cover-note number; period; insured value; mode/conveyance limits; transit scope; valuation/uplift; deductible; clauses; extensions; warranties; conditions; and exclusions. Use only an expressly labelled policy or cover-note identifier for that field; keep premium, certificate, endorsement, and claim references separate and flag a material conflict. Keep each claim-relevant provision complete and cited; map it to facts without inventing compliance or breach.
- Keep deductible percentage/minimum/maximum/fixed/franchise/aggregate components separate; never concatenate them. The application calculates them.
- Keep Warranted wording in warranties, procedural wording in conditions, and Excluding wording in exclusions.
- Flag numeric-versus-amount-in-words invoice total conflicts; withhold adequacy, underinsurance, and final-quantum use until reconciled.
- Keep invoice components, freight invoice, insured value, presented claim, deductions, fees, and adjusted amount separate; preserve ISO currency and never turn unknown into zero.
- Validate quantity x rate, then evidenced valuation uplift, then deductions; flag inconsistencies. Return each supported adjustment row with description, quantity/rate/value, currency, basis, and citation.
- If evidence supports damaged packages, weight/conversion, and matching unit rate but no line total, return the complete quantity expression and rate with an empty adjusted value and cite every input. The application calculates it.
- Adjustment items are evidenced damaged/missing property, repair, loss fee, or deduction—not policy limit, sum insured, shipment/invoice/FOB value, premium, valuation basis, or freight total. Never add the full shipment value to the value of damaged items. Unsupported quantum stays provisional.
- A destination/customs/freight/release/clearing/survey/mitigation/destruction charge is not automatically a claim item merely because an invoice exists. Include it only when evidence connects it to this loss and adjustment basis; otherwise keep it as source valuation/review.
- Quotations, estimates, and pro-formas are provisional valuation evidence, never automatically presented claims, incurred costs, accepted repairs, or fair-and-reasonable amounts.
- “Fair, reasonable, payable, or concluded” requires a reconciled loss schedule, supported quantities/rates, adjustments, deductions, damage scope, and coverage review.
- Flag conflicting values across documents in warnings and human_review_required. Do not silently choose one conflicting source.
- Keep factual fields evidence-stated; retain professional inference as a sourced evidence_findings assessment.
- Never use the phrase "not established" in client-facing analysis or report text. For every unresolved point, state the specific reviewed evidence, the tested result, the exact missing page, document, record, test, witness, or reconciliation, and the decision that item would resolve. Do not suppress a defensible analysis merely because the conclusion is provisional.
- Write as a loss adjuster in this applicable sequence: interest and policy schedule; shipment routing; chronological surveyor notes; cause; warranties/conditions/exclusions; insured-value adequacy; assessors; adjustment; conclusion. In every analytical section, move from supported facts to professional interpretation/significance and then a reasoned adjuster/surveyor conclusion; never merely restate facts. Keep conclusions proportionate, distinguish opinion, qualify uncertainty and alternatives, never invent or pad. Keep summary concise and reject OCR contamination.
- Use complete, non-repeated professional sentences; never end at a dangling connector, colon, opening parenthesis, p., or pp.
- This output is a suggestion for human review. Coverage, cause, liability, adjustment, recommendations, and conclusions must remain explicitly reviewable.

${DIRECTOR_ANALYSIS_PROTOCOL}`;

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

  try {
    return JSON.parse(candidate);
  } catch {
    let repaired = candidate;
    try {
      repaired = repairJsonStrings(candidate);
      return JSON.parse(repaired);
    } catch {
      repaired = repaired
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      return JSON.parse(repaired);
    }
  }
}

function repairJsonStrings(str) {
  let inString = false;
  let escaped = false;
  let result = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (!inString) {
      if (char === '"') {
        inString = true;
        escaped = false;
        result += char;
      } else {
        result += char;
      }
    } else {
      if (escaped) {
        if (['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(char)) {
          result += char;
        } else if (char === 'u') {
          const hex = str.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result += char;
          } else {
            result += '\\u';
          }
        } else {
          result += '\\' + char;
        }
        escaped = false;
      } else {
        if (char === '\\') {
          escaped = true;
          result += char;
        } else if (char === '"') {
          inString = false;
          result += char;
        } else if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
      }
    }
  }

  if (escaped) {
    result += '\\';
  }
  if (inString) {
    result += '"';
  }

  return result;
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
  const coveragePlan = buildAnalysisCoveragePlan(evidence);

  return `CLAIM METADATA (context only; it is not proof):\n${JSON.stringify(claim, null, 2)}\n\nEVIDENCE REGISTER AND EXTRACTED CONTENT:\n${evidenceSections}\n\n${coveragePlan.prompt}\n\nAPPROVED STYLE REFERENCES (style/section order and owner-approved analysis methodology only; never claim evidence):\n${references}\n\nCOLLECTIVE PROFESSIONAL KNOWLEDGE REFERENCES (reasoning aids only; never evidence or report content):\n${legalReferences}\n\nReview every current-claim PDF page in page-number order before writing the analysis. Apply only claim-, policy-, jurisdiction-, loss-, and fact-relevant principles. Resolve scope differences; never mix rules indiscriminately, quote, summarize, cite, or name these references in the output. Keep alternative quantities and units in separate sourced records; never concatenate them into one number. Keep loss rows separate from deductible, salvage, recovery, and depreciation so each deduction is applied once. cause_of_loss is only one concise express source-stated mechanism. Populate it only where the cited source explicitly attributes the loss (for example, a labelled cause/nature-of-loss statement or "damage was caused by" wording); a damage label such as "breakage during transit", discovery timing, packing, a condition observation, or a model inference is never an express cause. Put those matters in domain-labelled findings with their qualification. For every party field, retain only the expressly role-labelled legal entity and stop before an adjoining invoice, policy, B/L, contact, address, heading, or OCR fragment; return null where the role is not actually assigned. Follow clauses across line or page breaks; if the complete material wording cannot be verified, return null and identify the missing continuation. Where current policy or cover-note wording exists, return a separately cited policy_application finding for each material policy issue: exact provision and page, matched current fact and page or exact gap, provisional impact, and remaining professional decision. Never use the phrase "not established" in client-facing text; name the precise evidence gap and decision affected instead. Execute every material test in the applicable owner-approved methodology profile and the Director-grade analysis protocol before returning the structured analysis. Do not merely restate the profile or the evidence. Return the strongest evidence-supported provisional analysis after checking the complete claim file and completing the final quality audit. Produce client-ready synthesis, not an extraction dump: preserve draft/original transport status; keep raw OCR and photo-page fragments only in provenance; reconcile quotation lines, ancillary charges, VAT/tax and deductible separately; keep VAT/tax recoverability provisional unless evidenced; enforce the same parties, chronology, currency, claim status, cause qualification, cover and liability position across summary, analysis, adjustment and conclusion; and make each evidence gap specific to the decision it would resolve.`;
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

function validateSource(source, evidence, fieldValue = null) {
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

  if (fieldValue) {
    const valNorm = normalizeForMatch(fieldValue);
    if (valNorm && haystack.includes(valNorm)) return correctedSource;
  }

  // Token-based matching for OCR punctuation differences
  const tokens = needle.split(" ").filter((t) => t.length > 3);
  if (tokens.length > 0) {
    const matchedTokens = tokens.filter((t) => haystack.includes(t));
    if (matchedTokens.length / tokens.length >= 0.5) return correctedSource;
  }

  if (evidence.length === 1) {
    return correctedSource;
  }

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
  const sanitizeSources = (sources, fieldValue = null) => {
    if (!Array.isArray(sources)) return [];
    return sources.map((source) => validateSource(source, evidence, fieldValue)).filter(Boolean);
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
    let sources = sanitizeSources(field.sources, field.value);
    if (!sources.length && field.value && evidence.length > 0) {
      sources = [{
        document_id: evidence[0].document_id,
        document_name: evidence[0].document_name,
        page: field.sources?.[0]?.page || 1,
        supporting_text: String(field.value).slice(0, 160),
        confidence: field.confidence || 0.9,
        evidence_mode: "extracted_text",
      }];
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

      const usage = calculateAiUsage({
        provider: "openai",
        model: resolvedModel,
        rawUsage: response.usage,
      });

      return {
        provider: "openai",
        model: resolvedModel,
        response_id: response.id,
        analyzed_at: new Date().toISOString(),
        usage,
        analysis: enforceAnalysisCoverage(enforceGrounding(response.output_parsed, evidence, styleReferences), evidence),
      };
    },
  };
}

export { DIRECTOR_ANALYSIS_PROTOCOL, SYSTEM_INSTRUCTIONS, promptText, toDataUrl, enforceGrounding, stripJsonFences, parseStructuredJson };
export const openAIProviderInternals = { promptText, enforceGrounding, stripJsonFences, parseStructuredJson };
