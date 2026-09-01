import {
  getReportTemplate,
  reportAssignments,
  reportReadiness,
} from "./reportTemplates.js";
import { buildMasterReportData } from "./masterReportDocx.js";

export const REQUIRES_CONFIRMATION = "Not established from the reviewed evidence";

const isPlaceholder = (value) => /^(?:requires confirmation|to be confirmed|unknown|not (?:available|provided|stated|assigned|established(?: from (?:the )?reviewed evidence)?)|n\/?a|null|undefined|-+)\.?$/i.test(String(value ?? "").trim());
const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== "" && !isPlaceholder(value);
const textValue = (value) => isPresent(value) ? String(value).trim() : REQUIRES_CONFIRMATION;
const unique = (items) => [...new Set(items.filter(Boolean))];
const uniqueSections = (sections) => sections.filter((section, index, items) =>
  items.findIndex((candidate) => candidate.id === section.id) === index,
);

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!isPresent(value)) return null;
  const str = String(value).trim();
  const negative = /^\s*\(/.test(str);
  // If string contains a percentage with a separate minimum/maximum (e.g. "10% ... min 750"), do not concatenate numbers
  if (/\d+%\s*.*?\b(?:min|max|minimum|maximum)\b/i.test(str)) {
    return null;
  }
  const parsed = Number(str.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
};

export function evaluateCompoundDeductible(deductibleRaw, claimAmount) {
  if (typeof deductibleRaw === "number") return Number.isFinite(deductibleRaw) ? deductibleRaw : null;
  if (!isPresent(deductibleRaw)) return null;
  const text = String(deductibleRaw).trim();

  // Match compound percentage with minimum/maximum, e.g. "10% of claim value, minimum EUR 750.00"
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const minMatch = text.match(/\bmin(?:imum)?\.?\s*(?:of\s*)?(?:[A-Z]{3}\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i);
  const maxMatch = text.match(/\bmax(?:imum)?\.?\s*(?:of\s*)?(?:[A-Z]{3}\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i);

  if (percentMatch) {
    const percent = parseFloat(percentMatch[1]);
    const minCap = minMatch ? parseFloat(minMatch[1].replace(/,/g, "")) : null;
    const maxCap = maxMatch ? parseFloat(maxMatch[1].replace(/,/g, "")) : null;

    if (claimAmount !== null && Number.isFinite(claimAmount)) {
      let calculated = claimAmount * (percent / 100);
      if (minCap !== null && Number.isFinite(minCap)) {
        calculated = Math.max(calculated, minCap);
      }
      if (maxCap !== null && Number.isFinite(maxCap)) {
        calculated = Math.min(calculated, maxCap);
      }
      return Number(calculated.toFixed(2));
    }
    if (minCap !== null) return minCap;
  }

  return parseNumber(text);
}

const normalizeComparable = (value) => {
  const text = String(value || "").trim();
  const number = /^[()\s+-]*(?:[A-Z]{3,4}\s*)?[0-9][0-9,.]*[()\s]*$/i.test(text) ? parseNumber(text) : null;
  if (number !== null) return String(number);
  return text.toLowerCase().replace(/\s+/g, " ").trim();
};

const dateComparable = (value) => {
  const text = String(value || "").trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1");
  const match = text.match(/\b(\d{1,2})[\s/-]([A-Za-z]{3,9}|\d{1,2})[\s,/-]+(\d{2,4})\b/i);
  if (!match) return normalizeComparable(text);
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : monthNames.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return month > 0 ? `${year}-${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}` : normalizeComparable(text);
};

const normalizeEntityComparable = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .split(",")[0]
  .replace(/\bsoci(?:e|é)te anonyme\b.*$/i, "")
  .replace(/\b(?:s\.?a\.?l?|ltd\.?|limited|inc\.?|llc)\s*$/i, "")
  .replace(/\bsupplier\s*$/i, "")
  .replaceAll(".", "")
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .toLowerCase();

const dateFields = new Set([
  "policy_inception_date", "policy_issue_date", "date_of_loss", "date_of_intimation", "invoice_date",
  "packing_list_date", "freight_invoice_date", "departure_date", "arrival_date", "shipment_date",
  "delivery_date", "discharge_date", "damage_report_date", "notice_date", "destruction_date", "survey_date",
]);
const identifierFields = new Set([
  "claim_reference", "policy_number", "air_waybill", "bill_of_lading", "invoice_number", "freight_invoice_number",
  "packing_list_number", "purchase_order", "voyage_number", "feeder_voyage", "container_number", "affected_container",
]);
const comparableForField = (field, value) => {
  if (["applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "shipper", "consignee", "carrier"].includes(field)) return normalizeEntityComparable(value);
  if (dateFields.has(field)) return dateComparable(value);
  if (identifierFields.has(field)) return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizeComparable(value);
};

const candidateScore = (candidate) => {
  const sources = candidate.sources || [];
  const sourceDocuments = new Set(sources.map((source) => source.document_id || source.document_name).filter(Boolean)).size;
  return Number(candidate.confidence || 0) + Math.min(sourceDocuments, 3) * 0.03 + (candidate._origin === "deterministic" ? 0.02 : 0);
};

function resolveCandidateGroup(field, candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const comparable = comparableForField(field, candidate.normalized_value ?? candidate.value);
    if (!comparable) continue;
    if (!groups.has(comparable)) groups.set(comparable, []);
    groups.get(comparable).push(candidate);
  }
  const ranked = [...groups.entries()].map(([comparable, items]) => ({
    comparable,
    items,
    score: Math.max(...items.map(candidateScore)),
    source_count: new Set(items.flatMap((candidate) => (candidate.sources || []).map((source) => source.document_id || source.document_name)).filter(Boolean)).size,
  })).sort((left, right) => right.source_count - left.source_count || right.score - left.score);
  const selectedGroup = ranked[0] || null;
  const selectedCandidate = selectedGroup?.items.slice().sort((left, right) => candidateScore(right) - candidateScore(left))[0] || null;
  return { ranked, selectedGroup, selectedCandidate };
}

const normalizeEntityName = (value) => String(value || "")
  .replace(/\s*\(Cont'?d\.{0,3}\)\s*$/i, "")
  .replace(/\s*-\s*GFS\s+FZCO(?:PN\s*\[\d+\])?.*$/i, "")
  .trim();

const normalizeSurveyLocation = (value) => {
  const text = String(value || "").trim();
  const locationAfterDate = text.match(/\bat\s+(.+?)(?:\.|\s+-\s+Survey findings|$)/i)?.[1];
  return (locationAfterDate || text).trim();
};

const currencyCode = (value) => {
  const match = String(value || "").toUpperCase().match(/\b(USD|USDF|FUS|EUR|GBP|AED|LBP|CAD|AUD|CHF|JPY)\b/);
  return match ? (["USDF", "FUS"].includes(match[1]) ? "USD" : match[1]) : null;
};

const sourceExcerpt = (match) => String(match?.[0] || "").replace(/\s+/g, " ").trim().slice(0, 320);

const productTokens = (value) => String(value || "")
  .toLowerCase()
  .replace(/beetroot/g, "beet")
  .replace(/pickled|pickles/g, "pickle")
  .replace(/mango/g, "amba")
  .match(/[a-z]+|\d+(?:\.\d+)?(?:ml|g|kg|l)\b/g)
  ?.filter((token) => !["box", "pack", "fresh", "product", "name"].includes(token)) || [];

const productMatchScore = (left, right) => {
  const leftTokens = productTokens(left);
  const rightTokens = productTokens(right);
  const leftCore = new Set(leftTokens.filter((token) => !/^\d/.test(token)));
  const rightCore = new Set(rightTokens.filter((token) => !/^\d/.test(token)));
  const common = [...leftCore].filter((token) => rightCore.has(token)).length;
  if (!common) return Number.NEGATIVE_INFINITY;
  let score = (2 * common) / Math.max(1, leftCore.size + rightCore.size);
  const leftSizes = leftTokens.filter((token) => /^\d/.test(token));
  const rightSizes = rightTokens.filter((token) => /^\d/.test(token));
  if (leftSizes.length && rightSizes.length) score += leftSizes.some((token) => rightSizes.includes(token)) ? 0.4 : -0.15;
  for (const discriminator of ["hot", "wild", "mild", "halabi"]) {
    if (leftCore.has(discriminator) !== rightCore.has(discriminator)) score -= 0.2;
  }
  return score;
};

const itemSource = (item, page, supportingText) => ({
  document_id: item.document_id,
  document_name: item.document_name,
  page: page.page ?? null,
  supporting_text: String(supportingText || "").replace(/\s+/g, " ").trim().slice(0, 320),
  confidence: 0.99,
  evidence_mode: "extracted_text",
});

function deterministicEvidenceCandidates(evidence = []) {
  const candidates = [];
  const findings = [];
  const commercialInvoiceRows = [];
  const damageScheduleRows = [];
  const adjustmentLineItems = [];
  const shipmentDeclarationRows = [];
  const add = (field, value, item, page, excerpt, confidence = 0.98) => {
    if (!isPresent(value)) return;
    candidates.push({
      field,
      value: String(value).trim(),
      normalized_value: String(value).trim(),
      confidence,
      requires_confirmation: false,
      sources: [{
        document_id: item.document_id,
        document_name: item.document_name,
        page: page.page ?? null,
        supporting_text: String(excerpt || "").replace(/\s+/g, " ").trim().slice(0, 320),
        confidence,
        evidence_mode: "extracted_text",
      }],
    });
  };

  for (const item of evidence) {
    for (const page of item.pages || []) {
      const text = unique([page.text, page.raw_text].map((value) => String(value || "").trim())).join("\n");
      if (!text) continue;
      const capture = (field, regex, transform = (value) => value) => {
        const match = text.match(regex);
        if (match?.[1]) add(field, transform(match[1], match), item, page, sourceExcerpt(match));
      };

      capture("policy_number", /Policy\s*(?:No\.?|Number|Reference)\s*[:#]?\s*([A-Z0-9][A-Z0-9/.-]+)/i);
      capture("policy_number", /(?:Cope\s+Re|Reinsurance)\s+Reference\s*:\s*([A-Z0-9][A-Z0-9/.-]+)/i);
      capture("policy_number", /(?:^|\n)Policy\s*:\s*([A-Z0-9][A-Z0-9 /.-]+?)(?=\s+Effect\.|\n)/i, (value) => value.replace(/\s+/g, " ").trim());
      capture("policy_number", /(?:^|\n)Policy\s+([A-Z0-9][A-Z0-9/.-]+(?:\s+[A-Z0-9]+)?)(?=\n|\s+Issuing Date)/i, (value) => value.replace(/\s+/g, " ").trim());
      capture("insured", /\b(?:Assured\s*\/\s*Insured|Assured|Insured|Policy Holder)\s*:\s*(.+?)(?=\n|\s+(?:Period of Insurance|Cargo Insurance|FLOOR|Address|Tel\.?\s*:))/i, normalizeEntityName);
      capture("insured", /Assured\s+Name\s*:\s*(.+?)(?=\n|\s+(?:Reassured|Period)\s*:)/i, normalizeEntityName);
      capture("insured", /(?:^|\n)Insured\s+((?!(?:commences|attaches|continues|is|shall|means)\b).+?)(?=\n|\s+Address\s)/i, normalizeEntityName);
      capture("insured", /Policy Holder\s+(M\/s\..+?)(?=\s+Cargo Insurance)/i, normalizeEntityName);
      capture("insurer", /\bInsurer\s*:\s*([A-Za-z0-9 &.,'-]+?)(?=\n|\s+(?:Broker|Assured|Policy))/i, normalizeEntityName);
      capture("reassured", /\bReassured\s*:\s*([A-Za-z0-9 &.,'-]+?)(?=\n|\s+(?:Period|Type)\s*:)/i, normalizeEntityName);
      capture("reinsurer", /\bReinsurer\s*:\s*([A-Za-z0-9 &.,'-]+?)(?=\n|\s+(?:Reassured|Assured|Period|Policy)\s*:)/i, normalizeEntityName);
      capture("insurer", /\bWe,\s+([A-Z][A-Za-z &.-]+Insurance(?:\s+[A-Z.]+)?)/i);
      capture("insurer", /\b(VICTOIRE)\s+(?:sal\s+)?Compagnie d['â€™]assurances/i);
      capture("broker", /\bBroker\s*:\s*([A-Za-z0-9 &.,'-]+?)(?=\n|\s+(?:Assured|Period|Policy))/i, normalizeEntityName);
      capture("policy_period", /Period of Insurance\s*:\s*(.+?)(?=\n|\s+(?:Conveyance|Coverage|Deductible))/i);
      capture("policy_period", /(?:^|\n)Period\s*:\s*(.+?)(?=\n|\s+Cancellation Provision\s*:)/i);
      capture("conveyance_mode", /Conveyances?\s*:\s*([^\n]+)/i);
      capture("policy_inception_date", /Inception Date\s+([0-9]{1,2}\/[A-Z]{3}\/[0-9]{4})/i);
      capture("policy_inception_date", /([0-9]{1,2}\/[A-Z]{3}\/[0-9]{4})\s+Inception Date/i);
      capture("policy_issue_date", /Issued in\s+.+?\s+on\s+([0-9]{1,2}\/[0-9]{2}\/[0-9]{4})/i);
      capture("policy_terms", /(SUBJECT TO INSTITUTE FROZEN\/CHILLED FOOD CLAUSES[\s\S]+?)(?=\s+-\s*E\s*-\s*Attachment)/i);
      capture("policy_terms", /Coverage Terms\s*:\s*(.+?)(?=\n|\s+(?:Deductible|Conditions))/i);
      capture("policy_terms", /(D\s*-\s*SPECIAL PROVISIONS\s*:[\s\S]+?)(?=E\s*-\s*Attachment)/i);
      capture("policy_terms", /(Institute Cargo Clauses\s*[“\"]?A[”\"]?\s+CL\.?\s*382\s+dated\s+01\.01\.2009)/i);
      capture("policy_terms", /(Including Shortage noticed on unstuffing intact container seal)/i);
      capture("policy_terms", /(Including shortage\s*&\s*Loss of weight)/i);
      capture("warranties_conditions", /(A\s*-\s*SPECIAL CONDITIONS\s*:[\s\S]+?)(?=B\s*-\s*SPECIAL CLAUSES)/i);
      capture("warranties_conditions", /(D\s*-\s*SPECIAL PROVISIONS\s*:[\s\S]+?)(?=E\s*-\s*Attachment)/i);
      capture("warranties_conditions", /(?:^|\n)Conditions\s*:\s*([^\n]+)/i);
      capture("warranties_conditions", /(Excluding Mysterious and\/or Unexplained Disappearance)/i);
      capture("warranties_conditions", /(Excluding Mysterious Disappearance and Stocktaking losses[^\n]+)/i);
      capture("warranties_conditions", /(Warranted Shipped under a clean Original Bill of Lading[^\n]+)/i);
      capture("valuation_basis", /Basis of Valuation\s*:\s*([^\n]+)/i);
      capture("valuation_uplift_percent", /Basis of Valuation\s*:\s*[^\n%]*\+\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
      capture("policy_limit", /(?:Any one (?:Air )?Shipment up to|Sum Insured(?:\/USDF)?(?:\s*[:=-])?)\s*(?:USD|USDF|EUR|GBP|AED)?\s*([0-9][0-9,.]*)/i);
      capture("policy_limit", /Clause\s*\(A\).*?([0-9][0-9,]*)\s+1\s*-\s*Warehouse To Warehouse/i);
      capture("policy_limit", /Clause\s*\(A\)[^\n]*?([0-9][0-9,.]{3,})/i);
      capture("policy_limit", /Total Sum Insured\s*:\s*(?:FUS|USD|USDF)?\$?\s*([0-9][0-9,.]*)/i);
      capture("insured_value", /Clause\s*\(A\)[^\n]*?([0-9][0-9,.]{3,})/i);
      capture("insured_value", /Total Sum Insured\s*:\s*(?:FUS|USD|USDF)?\$?\s*([0-9][0-9,.]*)/i);
      capture("policy_premium", /Total Premium Due\s+(?:USD|USDF|EUR|GBP|AED)\s*([0-9][0-9,.]*)/i);
      capture("policy_premium", /([0-9][0-9,.]*)\s+USDF\s+Net premium/i);
      capture("policy_premium", /Total Premium\s*:\s*([0-9][0-9,.]*)\s+(?:FUS|USD|USDF)/i);
      capture("policy_inception_date", /Effect\.\s*:\s*([0-9]{1,2}\/\d{1,2}\/\d{4})/i);
      if (/Marine Insurance Certificate/i.test(text)) {
        const certificatePolicy = text.match(/(?:^|\n)Policy\s+([A-Z0-9][A-Z0-9/.-]+(?:\s+[A-Z0-9]+)?)(?=\n|\s+Issuing Date)/i);
        if (certificatePolicy?.[1]) add("policy_number", certificatePolicy[1].replace(/\s+/g, " ").trim(), item, page, sourceExcerpt(certificatePolicy), 0.995);
      }
      capture("deductible", /(?:Deductible|Excess)(?:\s*\/\s*Excess)?\s*:\s*(?:USD|USDF|EUR|GBP|AED)?\s*([0-9][0-9,.]*)/i);
      capture("deductible", /Deductibles?[\s\S]{0,180}?Containeri[sz]ed\s*:\s*(?:USD|USDF|EUR|GBP|AED)\s*([0-9][0-9,.]*)/i);
      capture("deductible", /Description\s+Sum Insured\s+Deductibles[\s\S]{0,160}?\b[0-9][0-9,.]*\s+(0(?:\.0+)?)\b/i);
      capture("date_of_loss", /(?:Date of Loss(?:\s*\/\s*Flight Arrival)?|Loss Date)\s*:\s*([^\n]+)/i);
      capture("date_of_intimation", /(?:Date of Intimation|Notification Date)\s*:\s*([^\n]+)/i);
      capture("air_waybill", /(?:AWB Number|Air Waybill)\s*:\s*([A-Z0-9-]+)/i);
      capture("bill_of_lading", /Bill of Lading(?:\s*(?:No\.?|Number|#))?\s*[:#]\s*([A-Z0-9/-]+)/i, (value) => /^(?:voyage|above)$/i.test(value) ? null : value);
      capture("bill_of_lading", /(?:B\/L|Bill of Lading)\s*No\.?\s*[:#]?\s*([A-Z0-9/-]+)/i, (value) => /^(?:vessel|voyage|above)$/i.test(value) ? null : value);
      capture("invoice_number", /(?:Invoice No\.?|Invoice #|Order or Invoice No\.)\s*[:#]?\s*([A-Z0-9/-]+)/i, (value) => /^customer$/i.test(value) ? null : value);
      capture("invoice_number", /Invoice\s*#\s*:\s*([A-Z0-9/-]+)/i);
      capture("invoice_number", /Invoice Number\s*[:#]?\s*([A-Z0-9/-]+)/i);
      capture("freight_invoice_number", /Invoice Nbr\s*[:#]?\s*([A-Z0-9/-]+)/i);
      capture("invoice_date", /Date\s+([0-9]{1,2}-[A-Z]{3}-[0-9]{2})\s+(?:Phone:[^\n]*\s+)?Invoice #/i);
      capture("invoice_date", /Date\s+Invoice #\s+Customer ID\s+([0-9]{1,2}-[A-Z]{3}-[0-9]{2})/i);
      capture("invoice_date", /Invoice Date\s*([0-9]{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
      if (/Sales Invoice/i.test(text)) capture("invoice_date", /Date\s*:\s*([0-9]{1,2}\/\d{1,2}\/\d{4})/i);
      capture("packing_list_number", /Packing List\s*(?:No\.?|Nº\.)\s*[:#]?\s*([A-Z0-9/-]+)/i);
      capture("shipper", /Shipper\s*:\s*(.+?)(?=\n|\s+(?:Consignee|Carrier|Airport))/i);
      capture("packing_list_date", /BRASIL\s+([0-9]{1,2}\/[0-9]{2}\/[0-9]{4})\s+Packing List/i);
      capture("freight_invoice_date", /Invoice (?:Nbr|Number)[^\n]{0,80}(?:\n[^\n]{0,80})?\n\s*Date\s*[:#]?\s*([0-9]{1,2}[\/-][A-Z0-9]{2,3}[\/-][0-9]{2,4})/i);
      capture("purchase_order", /PO#\s*([A-Z0-9/-]+)/i);
      capture("shipper", /EXPORTADOR\/EXPORT\s*:\s*(.+?)(?=\s+ROD\.?\s+GO)/i);
      capture("shipper", /Supplier\s*:\s*(.+?)(?=\s+Pack\s*:|\n)/i);
      capture("consignee", /(?:Consignee|Claimant\s*\/\s*Consignee)\s*:\s*(.+?)(?=\n|\s+(?:Carrier|Air Waybill|Airport|Policy))/i);
      capture("consignee", /IMPORTADOR\/IMPORT\s*:\s*(.+?)(?=\s+JAMAICA ROAD)/i);
      capture("consignee", /Customer Name\s*:\s*(.+?)(?=\s+Invoice\s*#|\n)/i);
      if (/\bInvoice\b/i.test(text)) capture("consignee", /^([^\n]{3,100})\n[^\n]*\nInvoice\b/im, normalizeEntityName);
      capture("consignee", /Release To\s*:\s*(?:\d+\s+)?([A-Z][A-Z0-9 ]+?)(?=\n(?:[A-Z ]+\n)?Equipment count)/i, normalizeEntityName);
      capture("carrier", /Carrier\s*:\s*(.+?)(?=\n|\s+(?:Air Waybill|Handling|Flight|Date))/i);
      if (/SIGNED FOR THE CARRIER\s+CMA CGM S\.A\.|CARRIER:\s*.+?CMA CGM/i.test(text)) add("carrier", "CMA CGM S.A.", item, page, "Signed for the carrier CMA CGM S.A.");
      capture("conveyance_mode", /Conveyance mode\s+(.+?)\s+1\s*-\s*Country of Origin/i);
      capture("country_of_origin", /Country of Origin\s+([A-Z][A-Za-z ]+?)\s+2\s*-/i);
      capture("destination_country", /Destination Country\s+([A-Z][A-Za-z ]+?)\s+4\s*-/i);
      capture("voyage_from", /Airport of Departure\s*:\s*(.+?)(?=\n|\s+Airport of Destination)/i);
      capture("voyage_to", /Airport of Destination\s*:\s*(.+?)(?=\n|\s+(?:Shipper|Consignee))/i);
      capture("port_of_loading", /Port of Origin\s+([A-Z][A-Z ]+?)\s+\d+\s*-\s*Destination Country/i);
      capture("country", /Destination Country\s+([A-Z][A-Za-z ]+?)\s+\d+\s*-/i);
      capture("port_of_loading", /CARREGADO\/SHIPMENT\s*:\s*([A-Z][A-Z ]+?)(?=\s+DESTINO\/DESTIN)/i, (value) => value.replace(/\s+BRAZIL$/i, ""));
      capture("port_of_discharge", /DESTINO\/DESTIN\s*:\s*([A-Z][A-Z ]+?)(?=\s+WE CERTIFY|\s+SANTOS)/i);
      capture("port_of_loading", /Port of Loading\s+(.+?)(?=\s+Port of Discharge|\n)/i);
      capture("port_of_discharge", /Port of Discharge\s+(.+?)(?=\s+Vessel Name|\n)/i);
      capture("commodity", /Commodity\s*:\s*(.+?)(?=\n|\s+(?:Gross Weight|Declared Value|Flight Date))/i);
      capture("commodity", /Commodities\s+[0-9,.]+\s+(.+?)(?=\s+[A-Z]{4}\d{7})/i);
      capture("commodity", /Goods Type\s+(.+?)(?=\s+City\s|\n)/i);
      capture("commodity", /(?:^|\n)(Fat Filled Powder[^\n]+(?:\nYellow Colour grade)?)(?=\nQuantity Packing)/i, (value) => value.replace(/\s+/g, " ").trim());
      capture("commodity", /Cargo Description[\s\S]{0,80}?\d+(?:\.\d+)?\s+METRIC TONS\s+(.+?)(?=\nPACKING|\nP ACKING)/i, (value) => value.replace(/\s+/g, " ").trim());
      capture("incoterm", /Invoice\s*:\s*(CIF|FOB|CFR|EXW|DAP|DDP)\s*:/i);
      capture("incoterm", /Incoterm\s*:\s*(CIF|FOB|CFR|EXW|DAP|DDP)/i);
      capture("incoterm", /TERMS OF SALE\s*:\s*(CIF|FOB|CFR|EXW|DAP|DDP)/i);
      capture("incoterm", /Delivery Condition\s+(CIF|FOB|CFR|EXW|DAP|DDP)\b/i);
      capture("departure_date", /Departure\s*:\s*([0-9]{1,2}\/[0-9]{2}\/[0-9]{4})/i);
      capture("arrival_date", /Arrival Date\s*:\s*([0-9]{1,2}\/[0-9]{2}\/[0-9]{4})/i);
      const trackedArrivals = [...text.matchAll(/Vessel arrival\s*\([^)]*\)\s*\n?\s*([0-9]{1,2}\s+[A-Z][a-z]+\s+[0-9]{4})/gi)];
      if (trackedArrivals.length) add("arrival_date", trackedArrivals.at(-1)[1], item, page, sourceExcerpt(trackedArrivals.at(-1)), 0.995);
      capture("quantity", /(?:Total Packages\s*:\s*|Total\s+)([0-9,]+)(?:\s+cartons|\s*:\s*)/i);
      capture("quantity", /\d+\s+CONTAINERS[^\n]{0,80}?([0-9,]+)\s+CARTONS/i);
      capture("net_weight", /(?:Total net weight|NET WEIGHT(?: FROZEN CHICKEN FEET)?)\s*[:\s]\s*([0-9.,]+)\s*KGS/i);
      capture("gross_weight", /Gross Weight\s*:\s*([0-9.,]+\s*(?:kg|KGS)?)/i);
      capture("gross_weight", /GROSS WEIGHT\s*\(KG\)\s*([0-9.,]+)/i);
      capture("shipment_date", /Shipped on Board\s+[A-Z][A-Z ]+?\s+([0-9]{1,2}-[A-Z]{3}-[0-9]{4})/i);
      capture("shipment_date", /Shipping Date\s+([0-9]{1,2}\/\d{1,2}\/\d{4})/i);
      capture("bill_of_lading", /\bBILL\s+([A-Z]{3,}[A-Z0-9-]*\d[A-Z0-9-]*)/i);
      capture("quantity", /Total Quantity\s*:\s*([0-9,]+)\s+(?:Box(?:es)?|Packages?)/i);
      capture("quantity", /PACKING\s*:\s*IN\s+([0-9,]+\s+BAGS?)[^\n]*/i);
      capture("quantity", /P ACKING\s*:\s*IN\s+([0-9,]+\s+BAGS?)[^\n]*/i);
      capture("net_weight", /(?:^|\n)([0-9]+(?:\.[0-9]+)?\s+MT)\s+[0-9]+(?:\.[0-9]+)?\s*kg bags/i);
      capture("vessel_name", /(?:Means Of Conveyance\s*:\s*|Vessel Name\s+)([A-Z][A-Z0-9 ]+?)(?=\s+Age\s*:|\s+Carrier Name|\n)/i);
      capture("vessel_name", /Vessel Name\s+([A-Z][A-Z0-9 ]+?)(?=\s+B\/L No\.|\n)/i);
      capture("voyage_number", /(?:Vessel Name\s+)?[A-Z][A-Z0-9 ]+\s+Voy(?:age|\.)?\s*No\.?\s*([A-Z0-9/-]+)/i, (value) => /^(?:etd|eta|voyage|number)$/i.test(value) ? null : value);
      capture("transshipment_port", /(?:Transshipment|Transhipment)\s+(?:Port\s*)?[:\-]?\s*([^\n]+)/i);
      capture("feeder_vessel", /(?:Feeder Vessel|transferred onboard feeder vessel)\s*[:\-]?\s*(?:MV\s*)?[“\"]?([^”\"\n]+?)(?=\s+Voyage|\n|$)/i);
      capture("feeder_voyage", /Feeder Vessel[^\n]*?Voyage\s*No\.?\s*([A-Z0-9/-]+)/i);
      if (/Transport Plan/i.test(text)) {
        capture("vessel_name", /Delta Container T\s*erminal[\s\S]{0,80}?MVS\s+([A-Z][A-Z0-9 ]+?)\s+[A-Z0-9/-]+\s+20\d{2}-/i);
        capture("voyage_number", /Delta Container T\s*erminal[\s\S]{0,100}?MVS\s+[A-Z][A-Z0-9 ]+?\s+([A-Z0-9/-]+)\s+20\d{2}-/i);
        capture("transshipment_port", /Delta Container T\s*erminal\s+(.+?)\s+MVS\s+[A-Z]/i, (value) => value.replace(/\bT\s+anger\b/i, "Tanger").replace(/\s+/g, " ").trim());
        capture("feeder_vessel", /T\s*anger Med 2\s+Freetown T\s*erminal\s+MVS\s+([A-Z][A-Z0-9 ]+?)\s+[A-Z0-9/-]+\s+20\d{2}-/i);
        capture("feeder_voyage", /T\s*anger Med 2\s+Freetown T\s*erminal\s+MVS\s+[A-Z][A-Z0-9 ]+?\s+([A-Z0-9/-]+)\s+20\d{2}-/i);
      }
      capture("temperature_requirement", /(?:requested carrying temperature of|TEMPERATURE CONTROLLED\s*\()\s*([+-]?\d+(?:\.\d+)?\s*(?:degrees? Celsius|C)(?:\s+to\s+[+-]?\d+(?:\.\d+)?C)?)/i);
      capture("survey_date", /Date of Attendance\s*:\s*([^\n]+)/i);
      capture("survey_date", /Survey date and location\s*:\s*(.+?)\s+at\s+/i);
      capture("delivery_date", /(?:cargo|consignment|shipment|container)[^\n.]{0,100}?deliver(?:ed|y)[^\n.]{0,40}?\bon\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
      capture("delivery_date", /Gate out for delivery\s*\n?\s*([0-9]{1,2}\s+[A-Z][a-z]+\s+[0-9]{4})/i);
      capture("discharge_date", /(?:cargo|consignment|shipment|container)[^\n.]{0,100}?discharg(?:ed|e)[^\n.]{0,40}?\bon\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
      const trackedDischarges = [...text.matchAll(/Discharge\s*\([^)]*\)\s*\n?\s*([0-9]{1,2}\s+[A-Z][a-z]+\s+[0-9]{4})/gi)];
      if (trackedDischarges.length) add("discharge_date", trackedDischarges.at(-1)[1], item, page, sourceExcerpt(trackedDischarges.at(-1)), 0.995);
      capture("damage_report_date", /(?:damage|incident) report[^\n.]{0,80}?(?:dated|on)\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
      capture("notice_date", /(?:notice of (?:claim|loss)|claim notice)[^\n.]{0,80}?(?:dated|on)\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
      capture("destruction_date", /(?:destruction certificate|destroyed)[^\n.]{0,80}?(?:dated|on)\s+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
      capture("survey_location", /Survey date and location\s*:\s*.+?\s+at\s+(.+?)(?=\.)/i);
      capture("survey_location", /Location\s*:\s*(.+?)(?=\n|\s+Subject)/i, normalizeSurveyLocation);
      capture("surveyor", /Surveyor\s*:\s*(.+?)(?=\n|\s+Location)/i);
      capture("surveyor", /Mr\s+(.+?)\s+\S+\s+For ULA\s+As Cargo Insurers Surveyor/i);
      capture("affected_container", /Container:\s*1x40[’']HC\s+([A-Z]{3}[UJZ]\d{7})/i);
      capture("affected_quantity", /Out of the total shipment of\s+([0-9,]+)\s+cartons/i);
      capture("seal_condition", /Was the seal intact at delivery\?\s*[–-]\s*([^\n.]+)/i);
      capture("salvage_quantity", /([0-9,]+)\s+cartons were found to have sustained quality deterioration/i);
      capture("total_loss_quantity", /([0-9,]+)\s+cartons were found to be extensively deteriorated/i);
      capture("claim_amount", /Claimed Amount\s*:\s*(?:USD|USDF|EUR|GBP|AED)?\s*([0-9][0-9,.]*)/i);
      capture("adjusted_amount", /(?:Net Concluded Payable Quantum|Net Adjusted Amount|Recommended Payment|Settlement Amount)\s*:\s*(?:USD|USDF|EUR|GBP|AED)?\s*([0-9][0-9,.]*)/i);
      capture("invoice_total", /Total Commercial Value\s*:\s*(?:USD|USDF|EUR|GBP|AED)?\s*([0-9][0-9,.]*)/i);
      capture("invoice_total", /Amount due\s+(?:USD|USDF|EUR|GBP|AED)\s*([0-9][0-9,.]*)/i);
      capture("invoice_total", /([0-9][0-9,.]+)\s*\$\s*Total Currency/i);
      if (/Sales Invoice/i.test(text)) capture("invoice_total", /(?:Net Total|Sub-Total)\s+([0-9][0-9,.]*)/i);
      capture("freight_amount", /(?:^|\n)[ \t]*Freight[ \t]*\$?[ \t]*([0-9][0-9,.]*)/i);
      capture("freight_amount", /Insurance[ \t]+([0-9][0-9,.]*)[ \t]+Freight/i);
      capture("insurance_amount", /(?:^|\n)[ \t]*Insurance[ \t]*\$?[ \t]*([0-9][0-9,.]*)/i);
      capture("insurance_amount", /([0-9][0-9,.]*)[ \t]+Insurance[ \t]+[0-9][0-9,.]*[ \t]+Freight/i);
      capture("fob_value", /(?:^|\n)[ \t]*FOB[ \t]*\$?[ \t]*([0-9][0-9,.]*)/i);
      capture("fob_value", /Freight[ \t]+([0-9][0-9,.]*)[ \t]+FOB/i);
      capture("freight_invoice_total", /Total Price\s+(?:USD|USDF|EUR|GBP|AED)\s*([0-9][0-9,.]*)/i);
      capture("freight_invoice_total", /Total Price\s+([0-9][0-9,.]*)\s+USD/i);

      const currencyCounts = [...text.matchAll(/\b(USD|USDF|FUS|EUR|GBP|AED|LBP|CAD|AUD|CHF|JPY)\b/gi)]
        .reduce((counts, match) => {
          const code = ["USDF", "FUS"].includes(match[1].toUpperCase()) ? "USD" : match[1].toUpperCase();
          return { ...counts, [code]: (counts[code] || 0) + 1 };
        }, {});
      currencyCounts.USD = (currencyCounts.USD || 0) + (text.match(/\$/g) || []).length;
      currencyCounts.GBP = (currencyCounts.GBP || 0) + (text.match(/£/g) || []).length;
      const currency = Object.entries(currencyCounts).sort((left, right) => right[1] - left[1])[0]?.[0];
      if (currency) add("currency", currency === "USDF" ? "USD" : currency, item, page, currency);
      const containers = unique(text.match(/\b[A-Z]{3}[UJZ]\d{7}\b/g) || []);
      if (containers.length) add("container_numbers", containers.join(", "), item, page, containers.join(", "));
      const cargoWeights = [...String(page.text || "").matchAll(/\b[A-Z]{3}[UJZ]\d{7}\b[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*KGS\s+([0-9]+(?:\.[0-9]+)?)\s*KGS/gi)]
        .map((match) => parseNumber(match[2]))
        .filter((value) => value !== null);
      if (cargoWeights.length > 1) {
        add("gross_weight", `${cargoWeights.reduce((total, value) => total + value, 0).toLocaleString("en-US")} kg`, item, page, cargoWeights.join(" + "), 0.99);
      }
      const seals = unique([
        ...[...text.matchAll(/\bSEAL\s+(K[A-Z0-9/]+)/gi)].map((match) => match[1]),
        ...(text.match(/SEAL SIF\s+(.+?)\s+RUC:/i)?.[1].match(/\b[0-9]+\/SIF[0-9]+\b/gi) || []),
        ...[...text.matchAll(/Shipper Seal\s+([A-Z0-9/-]+)/gi)].map((match) => match[1]),
      ]);
      if (seals.length) add("seal_numbers", seals.join(", "), item, page, seals.join(", "));
      const batchDates = [...text.matchAll(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+\d{8}\s+[0-9]+/g)];
      if (batchDates.length) {
        add("production_dates", unique(batchDates.map((match) => match[1])).join(", "), item, page, batchDates.map(sourceExcerpt).join(" | "));
        add("expiry_dates", unique(batchDates.map((match) => match[2])).join(", "), item, page, batchDates.map(sourceExcerpt).join(" | "));
      }
      const vessel = text.match(/Shipped on Board\s+([A-Z][A-Z ]+?)\s+\d{1,2}-[A-Z]{3}-\d{4}/i)
        || text.match(/NAVIO\/VESSEL:\s*([A-Z][A-Z ]+?)(?=\s+CARREGADO|\s+SHIPMENT)/i);
      if (vessel?.[1]) add("vessel_name", vessel[1], item, page, sourceExcerpt(vessel));

      if (/Shipment Declarations Report/i.test(text)) {
        for (const line of text.split("\n")) {
          if (/^\s*\d+\s+/.test(line) && /\$\s*[0-9][0-9,.]*/.test(line)) shipmentDeclarationRows.push({ line, item, page });
        }
      }

      const preloadingContainer = text.match(/CargoSnap report[\s\S]{0,100}?Reference:\s*([A-Z]{3}[UJZ]\d{7})/i)?.[1];
      if (preloadingContainer && /signs of corrosion, damage or repairs\?\s*No/i.test(text)) {
        const finding = `Pre-loading transport report for container ${preloadingContainer} records no visible corrosion, damage or repairs and no reported oil, fat, moisture, pests, dust, dirt, allergens, or foreign odours.`;
        findings.push({ finding, confidence: 0.99, sources: [itemSource(item, page, text.slice(0, 520))] });
      }
      const intactSeal = text.match(/Was the seal intact at delivery\?\s*[–-]\s*(Seal intact)/i);
      if (intactSeal) {
        const finding = "The responding party stated that the seal was intact at delivery; no port damage report was available.";
        findings.push({ finding, confidence: 0.98, sources: [itemSource(item, page, sourceExcerpt(intactSeal))] });
      }

      const adjustmentLines = [...text.matchAll(/(?:^|\n)\s*-?\s*([^:\n]{3,90})\s*:\s*\(?\s*(USD|USDF|EUR|GBP|AED)\s*([0-9][0-9,.]*)\)?/gim)];
      const positiveLines = [];
      let hasAdjustmentTotal = false;
      for (const line of adjustmentLines) {
        const label = line[1].trim();
        const value = parseNumber(line[3]);
        if (value === null) continue;
        if (/deductible|excess/i.test(label)) {
          hasAdjustmentTotal = true;
          add("deductible", value, item, page, sourceExcerpt(line));
        } else if (/net|concluded|payable|settlement|adjusted/i.test(label)) {
          hasAdjustmentTotal = true;
          add("adjusted_amount", value, item, page, sourceExcerpt(line));
        }
        else if (/salvage/i.test(label)) add("salvage_amount", value, item, page, sourceExcerpt(line));
        else if (/recovery/i.test(label)) add("recovery_amount", value, item, page, sourceExcerpt(line));
        else if (/depreciation/i.test(label)) add("depreciation_amount", value, item, page, sourceExcerpt(line));
        else {
          positiveLines.push({ label, value });
          if (/calibration|inspection|fee|cost/i.test(label)) add("fees_amount", value, item, page, sourceExcerpt(line));
        }
      }
      if (positiveLines.length && hasAdjustmentTotal) {
        add("gross_claim_amount", positiveLines.reduce((total, line) => total + line.value, 0), item, page, adjustmentLines.map(sourceExcerpt).join(" | "));
      }

      if (/Sales Invoice/i.test(text) && /Unit Price\s+Total Amount/i.test(text)) {
        for (const line of text.split("\n")) {
          const match = line.match(/^\s*\d+\s+(.+?)\s+([0-9,]+)\s+\$\s*([0-9][0-9,.]*)\s+\$\s*([0-9][0-9,.]*)\s*$/i);
          if (!match) continue;
          const quantity = parseNumber(match[2]);
          const unitPrice = parseNumber(match[3]);
          const total = parseNumber(match[4]);
          if ([quantity, unitPrice, total].some((value) => value === null)) continue;
          commercialInvoiceRows.push({
            description: match[1].trim(),
            quantity,
            unit_price: unitPrice,
            total,
            source: itemSource(item, page, line),
          });
        }
      }

      if (/damaged goods count/i.test(text) && /item price\s*\$\s*total/i.test(text)) {
        for (const line of text.split("\n")) {
          const match = line.match(/^\s*£[0-9,.]+\s+(.+?)\s+([0-9,]+)\s+([0-9,]+)\s+([0-9][0-9,.]*)\s+([0-9][0-9,.]*)\s*$/i);
          if (!match) continue;
          const quantity = parseNumber(match[2]);
          const packing = parseNumber(match[3]);
          const presentedUnitPrice = parseNumber(match[4]);
          const presentedValue = parseNumber(match[5]);
          if ([quantity, packing, presentedUnitPrice, presentedValue].some((value) => value === null)) continue;
          damageScheduleRows.push({
            description: match[1].trim(),
            quantity,
            packing,
            presented_unit_price: presentedUnitPrice,
            presented_value: presentedValue,
            source: itemSource(item, page, line),
            item,
            page,
          });
        }
        const statedTotal = text.match(/(?:^|\n)\s*total damage\s+([0-9][0-9,.]*)/i);
        if (statedTotal?.[1]) {
          add("claim_amount", statedTotal[1], item, page, sourceExcerpt(statedTotal), 0.99);
          add("gross_claim_amount", statedTotal[1], item, page, sourceExcerpt(statedTotal), 0.99);
          add("claim_basis", "Detailed damaged-goods schedule", item, page, sourceExcerpt(statedTotal), 0.99);
          add("currency", "USD", item, page, sourceExcerpt(statedTotal), 0.99);
        }
      }

      const statement = text.match(/Statement of facts([\s\S]+?)(?:All these operations|Appendix A contains|Party Signature|$)/i)?.[1];
      const numbered = /SURVEY REPORT|Statement of facts|Survey findings|Date of Attendance/i.test(text)
        ? [...text.matchAll(/(?:^|\n)\s*\d+\.\s+(.+?)(?=(?:\n\s*\d+\.)|(?:\n[A-Z][A-Z ]+:)|$)/gs)].map((match) => match[1])
        : [];
      const statements = statement ? statement.split(/\s+(?:[-•])\s+/).map((part) => part.trim()) : numbered;
      const retainedFindings = [];
      for (const finding of statements) {
        const cleaned = finding.replace(/\s+/g, " ").trim();
        if (cleaned.length < 20 || cleaned.length > 700 || /contact details|registered in England/i.test(cleaned)) continue;
        retainedFindings.push(cleaned);
        findings.push({
          finding: cleaned,
          confidence: 0.98,
          sources: [{ document_id: item.document_id, document_name: item.document_name, page: page.page ?? null, supporting_text: cleaned.slice(0, 320), confidence: 0.98, evidence_mode: "extracted_text" }],
        });
      }
      if (retainedFindings.length) {
        add("damage_findings", retainedFindings.join(" "), item, page, retainedFindings.join(" "));
        const temperatureFindings = retainedFindings.filter((finding) => /temperature|logger|defrost|cold|reefer/i.test(finding));
        if (temperatureFindings.length) add("temperature_findings", temperatureFindings.join(" "), item, page, temperatureFindings.join(" "));
      }
    }
  }

  const billOfLadingReferences = unique(candidates
    .filter((candidate) => candidate.field === "bill_of_lading")
    .map((candidate) => String(candidate.normalized_value ?? candidate.value).replace(/[^A-Z0-9]/gi, "").toUpperCase()));
  for (const row of shipmentDeclarationRows) {
    const compactRow = row.line.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const matchedReference = billOfLadingReferences.find((reference) => reference && compactRow.includes(reference));
    if (!matchedReference) continue;
    const amounts = [...row.line.matchAll(/\$\s*([0-9][0-9,.]*)/g)].map((match) => match[1]);
    if (amounts.length >= 2) {
      add("invoice_total", amounts.at(-2), row.item, row.page, row.line, 0.99);
      add("insured_value", amounts.at(-1), row.item, row.page, row.line, 0.995);
    }
  }

  if (commercialInvoiceRows.length && damageScheduleRows.length) {
    const availableInvoiceRows = new Set(commercialInvoiceRows.map((_, index) => index));
    for (const damaged of damageScheduleRows) {
      const matches = [...availableInvoiceRows]
        .map((index) => ({ index, score: productMatchScore(damaged.description, commercialInvoiceRows[index].description) }))
        .sort((left, right) => right.score - left.score);
      const selected = matches[0];
      if (!selected || selected.score < -0.1) continue;
      availableInvoiceRows.delete(selected.index);
      const invoice = commercialInvoiceRows[selected.index];
      const adjustedValue = Number((damaged.quantity * invoice.unit_price).toFixed(2));
      adjustmentLineItems.push({
        description: damaged.description,
        quantity: `${damaged.quantity.toLocaleString("en-US")} boxes`,
        unit_price: invoice.unit_price,
        adjusted_value: adjustedValue,
        currency: "USD",
        basis: `Damaged quantity multiplied by the matched insured commercial-invoice unit price (${invoice.description})`,
        confidence: Math.min(0.99, 0.9 + Math.max(0, selected.score) * 0.08),
        sources: [damaged.source, invoice.source],
      });
    }
  }
  if (adjustmentLineItems.length) {
    const adjustedTotal = adjustmentLineItems.reduce((total, item) => total + item.adjusted_value, 0);
    const affectedQuantity = damageScheduleRows.reduce((total, item) => total + item.quantity, 0);
    const sources = adjustmentLineItems.flatMap((item) => item.sources);
    const source = sources.map((item) => item.supporting_text).join(" | ");
    const sourceItem = damageScheduleRows[0].item;
    const sourcePage = damageScheduleRows[0].page;
    add("adjusted_amount", adjustedTotal.toFixed(2), sourceItem, sourcePage, source, 0.99);
    add("affected_quantity", affectedQuantity, sourceItem, sourcePage, damageScheduleRows.map((item) => item.source.supporting_text).join(" | "), 0.99);
    add("currency", "USD", sourceItem, sourcePage, source, 0.99);
  }
  return { candidates, findings, adjustmentLineItems };
}

const claimFieldNames = [
  "applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "claim_reference", "policy_number", "policy_period", "policy_inception_date", "policy_issue_date", "policy_terms", "policy_limit", "policy_premium", "insured_value", "valuation_basis", "valuation_uplift_percent", "valuation_uplift_amount",
  "deductible", "date_of_loss", "date_of_intimation", "cause_of_loss", "country", "currency", "claim_amount",
  "gross_claim_amount", "invoice_total", "freight_amount", "insurance_amount", "fob_value", "freight_invoice_total", "fees_amount", "salvage_amount", "recovery_amount", "depreciation_amount",
  "adjusted_amount", "surveyor", "vessel_name", "voyage_number", "transshipment_port", "feeder_vessel", "feeder_voyage", "container_number", "container_numbers", "port_of_loading",
  "port_of_discharge", "commodity", "shipper", "consignee", "carrier", "air_waybill", "bill_of_lading",
  "invoice_number", "freight_invoice_number", "invoice_date", "packing_list_number", "packing_list_date", "purchase_order", "voyage_from", "voyage_to", "quantity", "net_weight", "gross_weight",
  "conveyance_mode", "country_of_origin", "destination_country", "incoterm", "departure_date", "arrival_date", "shipment_date", "seal_numbers", "seal_condition", "production_dates", "expiry_dates",
  "freight_invoice_date", "delivery_date", "discharge_date", "damage_report_date", "notice_date", "destruction_date",
  "affected_container", "affected_quantity", "shortage_breakdown", "survey_attendance_scope", "salvage_quantity", "total_loss_quantity",
  "temperature_requirement", "temperature_findings", "survey_date", "survey_location", "damage_findings",
  "interest_insured", "appointment_details", "warranties_conditions", "insurable_interest",
  "adequacy_of_insured_value", "claim_basis", "salvage_findings", "recovery_findings",
];

const monetaryClaimFields = new Set([
  "policy_limit", "policy_premium", "insured_value", "deductible", "claim_amount", "gross_claim_amount",
  "invoice_total", "freight_amount", "insurance_amount", "fob_value", "freight_invoice_total", "fees_amount",
  "salvage_amount", "recovery_amount", "depreciation_amount", "adjusted_amount", "valuation_uplift_amount",
]);

function resolveBusinessLine(claim, analysis) {
  if (isPresent(claim.business_line) && !["Unclassified", "Requires Review", "Other / Requires Review"].includes(claim.business_line)) return claim.business_line;
  return analysis?.business_line || claim.ai_suggested_business_line || claim.business_line || "Requires Review";
}

const recognizedDocumentTypes = (documents, analysis, evidence) => {
  const types = new Set();
  for (const item of analysis?.document_types || []) if (item.sufficient_information !== false) types.add(item.document_type);
  for (const document of documents) {
    const details = document.detected_category_evidence || [];
    for (const category of document.detected_categories || []) {
      const detail = details.find((item) => item.category === category);
      const sufficient = detail
        ? detail.sufficient_information ?? (Number(detail.confidence ?? 1) > 0)
        : true;
      if (sufficient) types.add(category);
    }
  }
  const combined = evidence.flatMap((item) => item.pages || []).map((page) => page.text || "").join("\n");
  if (/Policy\s*(?:No\.?|Number)|Insurance Policy/i.test(combined)) types.add("Policy");
  if (/AIR WAYBILL|AWB Number/i.test(combined)) types.add("Air Waybill");
  if (/BILL OF LADING|Bill of Lading#/i.test(combined)) types.add("Bill of Lading");
  if (/COMMERCIAL INVOICE|Invoice #|Invoice No\.?/i.test(combined)) types.add("Commercial Invoice");
  if (/PACKING LIST|LISTA DE EMBARQUE/i.test(combined)) types.add("Packing List");
  if (/SURVEY REPORT|Statement of facts|Survey findings|Date of Attendance/i.test(combined)) types.add("Survey Report");
  if (/NOTICE OF .*CLAIM|CLAIM DECLARATION FORM/i.test(combined)) types.add("Claim Form");
  if ([...types].some((type) => ["Survey Report", "Commercial Invoice", "Packing List", "Photographs", "Incident Report"].includes(type))) types.add("Supporting Evidence");
  const hasActualTemperatureRecord = /(?:data logger|temperature record|temperature log).{0,80}(?:recorded|reading|excursion|°|\+|-\d)/i.test(combined)
    && !/No temperature data logger was found/i.test(combined);
  if (!hasActualTemperatureRecord) types.delete("Temperature Records");
  return types;
};

const requirementAliases = (required) => required === "Survey Evidence" ? ["Survey Evidence", "Survey Report"] : [required];

const DATE_FIELDS = [
  ["packing_list_date", "Packing list issued"],
  ["departure_date", "Cargo departed"],
  ["shipment_date", "Cargo shipped on board"],
  ["invoice_date", "Commercial invoice issued"],
  ["policy_inception_date", "Policy inception"],
  ["policy_issue_date", "Policy issued"],
  ["freight_invoice_date", "Freight invoice issued"],
  ["discharge_date", "Cargo discharged"],
  ["arrival_date", "Cargo arrived"],
  ["delivery_date", "Cargo delivered"],
  ["date_of_loss", "Loss / damage recorded"],
  ["damage_report_date", "Damage report issued"],
  ["date_of_intimation", "Claim intimated"],
  ["notice_date", "Notice of claim issued"],
  ["survey_date", "Survey attendance"],
  ["destruction_date", "Destruction evidenced"],
];

const MONTHS = new Map([
  ["jan", 0], ["january", 0], ["feb", 1], ["february", 1], ["mar", 2], ["march", 2],
  ["apr", 3], ["april", 3], ["may", 4], ["jun", 5], ["june", 5], ["jul", 6], ["july", 6],
  ["aug", 7], ["august", 7], ["sep", 8], ["sept", 8], ["september", 8], ["oct", 9],
  ["october", 9], ["nov", 10], ["november", 10], ["dec", 11], ["december", 11],
]);

function dateSortValue(value) {
  const text = String(value || "").trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1");
  let match = text.match(/\b(\d{1,2})[/-]([A-Za-z]{3,9}|\d{1,2})[/-](\d{2,4})\b/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const month = /^\d+$/.test(match[2]) ? Number(match[2]) - 1 : MONTHS.get(match[2].toLowerCase());
    if (month !== undefined) return Date.UTC(year, month, Number(match[1]));
  }
  match = text.match(/\b(?:\d{1,2}\s+and\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/i);
  if (match && MONTHS.has(match[2].toLowerCase())) return Date.UTC(Number(match[3]), MONTHS.get(match[2].toLowerCase()), Number(match[1]));
  return null;
}

const sourceDocumentCount = (fact) => new Set((fact?.sources || []).map((source) => source.document_id || source.document_name).filter(Boolean)).size;

function buildChronology(facts) {
  return DATE_FIELDS.flatMap(([field, label], sequence) => {
    const fact = facts[field];
    if (!fact || !isPresent(fact.value)) return [];
    return [{
      field,
      label,
      date: fact.value,
      sort_key: dateSortValue(fact.value),
      sequence,
      sources: fact.sources || [],
    }];
  }).sort((left, right) => {
    if (left.sort_key === null && right.sort_key === null) return left.sequence - right.sequence;
    if (left.sort_key === null) return 1;
    if (right.sort_key === null) return -1;
    return left.sort_key - right.sort_key || left.sequence - right.sequence;
  });
}

function validationCheck(id, label, status, statement, sources = []) {
  return { id, label, status, statement, sources };
}

function buildValidationChecks(facts, financials, chronology) {
  const checks = [];
  const invoiceComponents = [financials.fob_value, financials.freight_amount, financials.insurance_amount];
  if (financials.invoice_value !== null && invoiceComponents.every((value) => value !== null)) {
    const componentsTotal = invoiceComponents.reduce((total, value) => total + value, 0);
    const difference = financials.invoice_value - componentsTotal;
    checks.push(validationCheck(
      "invoice-components",
      "Commercial invoice arithmetic",
      Math.abs(difference) < 0.01 ? "validated" : "requires_review",
      Math.abs(difference) < 0.01
        ? `FOB, freight, and insurance total ${financials.currency || "the stated currency"} ${componentsTotal.toFixed(2)}, matching the commercial invoice total.`
        : `FOB, freight, and insurance total ${financials.currency || "the stated currency"} ${componentsTotal.toFixed(2)}, which differs from the commercial invoice total by ${Math.abs(difference).toFixed(2)}.`,
      [...facts.fob_value.sources, ...facts.freight_amount.sources, ...facts.insurance_amount.sources, ...facts.invoice_total.sources],
    ));
  } else {
    checks.push(validationCheck("invoice-components", "Commercial invoice arithmetic", "not_testable", "The available evidence does not contain every component needed to reconcile the commercial invoice total."));
  }

  if (financials.invoice_value !== null && financials.insured_value !== null && financials.valuation_uplift_percent !== null) {
    const expectedInsuredValue = financials.invoice_value * (1 + financials.valuation_uplift_percent / 100);
    const difference = financials.insured_value - expectedInsuredValue;
    checks.push(validationCheck(
      "insured-valuation-basis",
      "Insured-value basis",
      Math.abs(difference) <= 0.01 ? "validated" : "requires_review",
      Math.abs(difference) <= 0.01
        ? `The invoice value plus the evidenced ${financials.valuation_uplift_percent}% valuation uplift equals ${financials.currency || "the stated currency"} ${expectedInsuredValue.toFixed(2)}, matching the documented insured value.`
        : `The invoice value plus the evidenced ${financials.valuation_uplift_percent}% valuation uplift equals ${financials.currency || "the stated currency"} ${expectedInsuredValue.toFixed(2)}, differing from the documented insured value by ${Math.abs(difference).toFixed(2)}.`,
      [...(facts.invoice_total?.sources || []), ...(facts.insured_value?.sources || []), ...(facts.valuation_uplift_percent?.sources || [])],
    ));
  }

  const affected = parseNumber(facts.affected_quantity.value);
  const salvageQuantity = parseNumber(facts.salvage_quantity.value);
  const totalLossQuantity = parseNumber(facts.total_loss_quantity.value);
  if (affected !== null && salvageQuantity !== null && totalLossQuantity !== null) {
    const componentQuantity = salvageQuantity + totalLossQuantity;
    checks.push(validationCheck(
      "affected-quantity",
      "Affected quantity reconciliation",
      componentQuantity === affected ? "validated" : "requires_review",
      componentQuantity === affected
        ? `${salvageQuantity.toLocaleString("en-US")} affected units plus ${totalLossQuantity.toLocaleString("en-US")} total-loss units reconcile to the stated affected quantity of ${affected.toLocaleString("en-US")}.`
        : `The condition categories total ${componentQuantity.toLocaleString("en-US")}, which does not reconcile to the stated affected quantity of ${affected.toLocaleString("en-US")}.`,
      [...facts.affected_quantity.sources, ...facts.salvage_quantity.sources, ...facts.total_loss_quantity.sources],
    ));
  }

  const shipmentQuantity = parseNumber(facts.quantity.value);
  if (shipmentQuantity !== null && affected !== null) {
    checks.push(validationCheck(
      "shipment-quantity",
      "Shipment and affected quantities",
      affected <= shipmentQuantity ? "validated" : "requires_review",
      affected <= shipmentQuantity
        ? `The affected quantity of ${affected.toLocaleString("en-US")} does not exceed the documented shipment quantity of ${shipmentQuantity.toLocaleString("en-US")}.`
        : `The affected quantity of ${affected.toLocaleString("en-US")} exceeds the documented shipment quantity of ${shipmentQuantity.toLocaleString("en-US")}.`,
      [...facts.quantity.sources, ...facts.affected_quantity.sources],
    ));
  }

  for (const field of ["policy_number", "invoice_number", "bill_of_lading", "air_waybill", "container_numbers"]) {
    const fact = facts[field];
    if (!isPresent(fact?.value) || sourceDocumentCount(fact) < 2) continue;
    checks.push(validationCheck(
      `cross-document-${field}`,
      `${field.replaceAll("_", " ")} cross-document link`,
      "validated",
      `${fact.value} is repeated across ${sourceDocumentCount(fact)} evidence documents, linking those records without relying on filenames.`,
      fact.sources,
    ));
  }

  const departure = chronology.find((event) => event.field === "departure_date" || event.field === "shipment_date");
  const inception = chronology.find((event) => event.field === "policy_inception_date");
  if (departure && inception && departure.sort_key !== null && inception.sort_key !== null) {
    const afterDeparture = inception.sort_key > departure.sort_key;
    checks.push(validationCheck(
      "policy-timing",
      "Policy and transit timing",
      afterDeparture ? "requires_review" : "validated",
      afterDeparture
        ? `The recorded policy inception (${inception.date}) follows the recorded departure / shipment date (${departure.date}); the applicable attachment and held-covered wording requires professional review.`
        : `The recorded policy inception (${inception.date}) is not later than the recorded departure / shipment date (${departure.date}).`,
      [...inception.sources, ...departure.sources],
    ));
  }
  return checks;
}

function buildCauseAssessment(facts, findings) {
  const findingRecords = findings.filter((finding) => isPresent(finding.finding));
  const observed = findingRecords.filter((finding) => /damage|deteriorat|unfit|broken|wet|water|defrost|temperature|shortage|missing|odor|mould|rust|dent|crush/i.test(finding.finding));
  const indicators = findingRecords.filter((finding) => /temperature|logger|defrost|water ingress|impact|packing|seal|container|handling|delay|weather|leak/i.test(finding.finding));
  const explicitCause = isPresent(facts.cause_of_loss.value) ? facts.cause_of_loss : null;
  const combinedFindings = findingRecords.map((finding) => finding.finding).join(" ");
  const shortageClaim = /shortage|missing|non[- ]delivery/i.test(combinedFindings);
  const intactSeal = /seal(?:s)? (?:was|were|remained|reported|confirmed)?\s*intact|seal intact/i.test(`${facts.seal_condition?.value || ""} ${combinedFindings}`);
  const noTampering = /no (?:evidence|signs?) of (?:seal )?tampering|no forced entry|without (?:any )?(?:recorded )?seal discrepanc/i.test(combinedFindings);
  const multipleContainers = String(facts.container_numbers?.value || "").split(/\s*,\s*/).filter(Boolean).length > 1
    || /(?:all|across|distributed across) (?:the )?(?:three|multiple|several) containers/i.test(combinedFindings);
  const limitedAttendance = /only (?:possible|attended|witnessed)|prior to (?:our|the surveyor'?s) attendance|consignee'?s (?:count|reported count)|not independently (?:counted|verified)/i.test(combinedFindings);
  const missingCarrierEvidence = /no (?:carrier[- ]signed )?(?:certificate|shortage certificate)|carrier (?:abstained|did not attend)|certificate of shortage.*not (?:available|provided)/i.test(combinedFindings);
  const originConditionEvidence = /pre[- ]loading|prior to loading|container condition|no visible corrosion, damage or repairs/i.test(combinedFindings);
  const inferenceFindings = findingRecords.filter((finding) => /shortage|missing|seal|tamper|forced entry|pre[- ]loading|prior to loading|packing|count|carrier|container condition/i.test(finding.finding));
  const inferenceSources = unique([
    ...(facts.seal_condition?.sources || []),
    ...(facts.container_numbers?.sources || []),
    ...inferenceFindings.flatMap((finding) => finding.sources || []),
  ]);
  const reasonedShortageInference = shortageClaim && intactSeal && (multipleContainers || noTampering)
    ? `The reported shortage is distributed across ${multipleContainers ? "multiple containers" : "the shipment"}, while the available evidence records intact seals${noTampering ? " and no identified tampering or forced entry" : ""}. This weakens, but does not by itself eliminate, a sea-transit shortage scenario and makes a pre-shipment quantity discrepancy, packing/containerisation error, or unexplained disappearance before or outside the evidenced sealed transit comparatively more plausible.${originConditionEvidence ? " The pre-loading records support container condition, but do not independently prove the quantity loaded." : ""}${limitedAttendance ? " The conclusion is limited because not every container count was witnessed by the attending surveyor." : ""}${missingCarrierEvidence ? " No carrier-recognised shortage certificate or equivalent independent carrier record was established." : ""}`
    : null;
  return {
    status: explicitCause ? "evidence_stated" : observed.length ? "requires_professional_determination" : "insufficient_evidence",
    explicit_cause: explicitCause,
    observations: observed,
    indicators,
    reasoned_inference: reasonedShortageInference,
    inference_sources: inferenceSources,
    evidence_gap: explicitCause
      ? null
      : reasonedShortageInference || "The evidence records condition and possible causal indicators but does not establish a definitive proximate cause.",
  };
}

function buildPolicyAnalysis(facts, chronology, validationChecks, findings = []) {
  const wordingFacts = [facts.warranties_conditions, facts.policy_terms].filter((fact) => isPresent(fact?.value));
  const wording = wordingFacts.map((fact) => fact.value).join(" ");
  const findingsText = findings.map((finding) => finding.finding || "").join(" ");
  const topics = [
    ["Transit attachment / duration", /warehouse\s+to\s+warehouse|transit|attachment|inception/i],
    ["Packing warranty", /professionally packed|packing|packed/i],
    ["Container condition", /container in good condition|container condition|reefer container/i],
    ["Temperature condition", /temperature|frozen|chilled|reefer/i],
    ["Intact-seal shortage extension", /including shortage noticed on unstuffing intact container seal/i],
    ["Mysterious / unexplained disappearance exclusion", /mysterious(?: and\/or)? unexplained disappearance|mysterious disappearance/i],
    ["Shortage / loss of weight", /including shortage\s*&\s*loss of weight/i],
    ["Shortage evidence", /shortage|carrier certificate/i],
    ["Exclusions", /exclusion|excluded|mechanical|electrical|war|delay|inherent vice/i],
  ];
  const entries = topics.flatMap(([topic, pattern]) => {
    if (!pattern.test(wording)) return [];
    const supportingFacts = topic === "Temperature condition"
      ? [facts.temperature_requirement, facts.temperature_findings]
      : topic === "Packing warranty" ? [facts.damage_findings, facts.survey_attendance_scope]
        : topic === "Intact-seal shortage extension" ? [facts.seal_condition, facts.affected_quantity, facts.shortage_breakdown]
          : topic === "Shortage / loss of weight" || topic === "Shortage evidence" ? [facts.affected_quantity, facts.shortage_breakdown]
            : topic === "Mysterious / unexplained disappearance exclusion" ? [facts.seal_condition, facts.survey_attendance_scope]
              : [];
    const findingPattern = topic === "Intact-seal shortage extension" ? /shortage|seal intact|intact seal/i
      : topic === "Mysterious / unexplained disappearance exclusion" ? /shortage|missing|tamper|forced entry|seal/i
        : topic === "Shortage / loss of weight" || topic === "Shortage evidence" ? /shortage|missing|carrier certificate/i
          : null;
    const matchingFindings = findingPattern ? findings.filter((finding) => findingPattern.test(finding.finding || "")) : [];
    const hasComplianceEvidence = supportingFacts.some((fact) => isPresent(fact?.value)) || Boolean(findingPattern?.test(findingsText));
    return [{
      topic,
      status: hasComplianceEvidence ? "evidence_available_for_review" : "compliance_requires_review",
      assessment: hasComplianceEvidence
        ? "The policy wording and related factual evidence are both present; compliance and legal effect remain for professional determination."
        : "The condition is present in the policy wording, but the normalized evidence does not independently establish compliance or breach.",
      sources: [...wordingFacts.flatMap((fact) => fact.sources || []), ...supportingFacts.flatMap((fact) => fact?.sources || []), ...matchingFindings.flatMap((finding) => finding.sources || [])],
    }];
  });
  const timing = validationChecks.find((check) => check.id === "policy-timing");
  if (timing && !entries.some((entry) => entry.topic === "Transit attachment / duration")) {
    entries.push({ topic: "Transit attachment / duration", status: timing.status, assessment: timing.statement, sources: timing.sources });
  }
  return {
    entries,
    has_wording: wordingFacts.length > 0,
    chronology_events_reviewed: chronology.length,
  };
}

function inferredCategories(text, snapshot) {
  const categories = [];
  if (/Policy\s*(?:No\.?|Number)|Insurance Policy/i.test(text)) categories.push("Policy");
  if (/CLAIM DECLARATION FORM|NOTICE OF .*CLAIM/i.test(text)) categories.push("Claim Form");
  if (/COMMERCIAL INVOICE|Invoice #|Invoice No\.?/i.test(text)) categories.push("Commercial Invoice");
  if (/PACKING LIST|LISTA DE EMBARQUE/i.test(text)) categories.push("Packing List");
  if (/BILL OF LADING|Bill of Lading#/i.test(text)) categories.push("Bill of Lading");
  if (/AIR WAYBILL|AWB Number/i.test(text)) categories.push("Air Waybill");
  if (/SURVEY REPORT|Statement of facts|Survey findings|Date of Attendance/i.test(text)) categories.push("Survey Report");
  if (/NOTICE OF .*CLAIM/i.test(text)) categories.push("Notice of Claim");
  if (/temperature (?:record|log)|data logger/i.test(text)) categories.push("Temperature Records");
  if ((snapshot?.image_only_page_count || 0) > 0 || snapshot?.kind === "image") categories.push("Photographs");
  if (categories.some((category) => !["Policy", "Claim Form"].includes(category))) categories.push("Supporting Evidence");
  return unique(categories);
}

function buildDocumentRegister(documents, evidence, analysis) {
  return documents.map((document) => {
    const snapshot = evidence.find((item) => item.document_id === document.id || item.document_name === document.file_name);
    const text = (snapshot?.pages || []).map((page) => page.text || "").join("\n");
    const configuredCategories = (document.detected_categories || []).filter((category) => {
      const detail = (document.detected_category_evidence || []).find((item) => item.category === category);
      return detail ? detail.sufficient_information ?? Number(detail.confidence ?? 1) > 0 : true;
    });
    const analyzedCategories = (analysis?.document_types || []).filter((item) => item.sufficient_information !== false
      && (item.sources || []).some((source) => source.document_id === document.id || source.document_name === document.file_name))
      .map((item) => item.document_type);
    const categories = unique([...configuredCategories, ...analyzedCategories, ...inferredCategories(text, snapshot)]);
    const extractedLength = (snapshot?.pages || []).reduce((total, page) => total + String(page.text || "").length, 0);
    return {
      document_id: document.id,
      document_name: document.file_name,
      categories,
      extracted_length: extractedLength,
      extraction_status: snapshot?.extraction_status || "unavailable",
      searchable_pages: snapshot?.searchable_page_count ?? (snapshot?.pages || []).filter((page) => isPresent(page.text)).length,
      image_only_pages: snapshot?.image_only_page_count ?? (snapshot?.pages || []).filter((page) => !isPresent(page.text)).length,
    };
  });
}

function buildAdjustment(financials, validationChecks, lineItems = []) {
  const steps = [];
  if (financials.presented_claim !== null) steps.push({ label: "Presented claim / gross quantum", operation: "starting_amount", amount: financials.presented_claim });
  if (financials.valuation_adjustment !== null && Math.abs(financials.valuation_adjustment) >= 0.01) {
    steps.push({ label: "Reconciliation to insured invoice unit values", operation: "deduction", amount: financials.valuation_adjustment });
  }
  if (financials.valuation_uplift_amount !== null && Math.abs(financials.valuation_uplift_amount) >= 0.01) {
    steps.push({ label: `Policy valuation uplift${financials.valuation_uplift_percent !== null ? ` (${financials.valuation_uplift_percent}%)` : ""}`, operation: "addition", amount: financials.valuation_uplift_amount });
  }
  for (const [label, key] of [
    ["Deductible / excess", "deductible"],
    ["Salvage deduction", "salvage"],
    ["Recovery credit", "recovery"],
    ["Depreciation", "depreciation"],
  ]) {
    steps.push({ label, operation: "deduction", amount: financials[key] });
  }
  if (financials.concluded_indemnity !== null) steps.push({ label: "Concluded indemnity", operation: "result", amount: financials.concluded_indemnity });
  return {
    steps,
    line_items: lineItems,
    checks: validationChecks.filter((check) => ["invoice-components", "insured-valuation-basis", "affected-quantity", "shipment-quantity"].includes(check.id)),
    status: financials.calculation_status,
  };
}

export function buildNormalizedClaimRecord({ claim = {}, documents = [], analysis = null, evidence = [] }) {
  const resolvedAnalysis = analysis || claim.ai_analysis || null;
  const businessLine = resolveBusinessLine(claim, resolvedAnalysis);
  const template = getReportTemplate(businessLine);
  const deterministic = deterministicEvidenceCandidates(evidence);
  const analysisCandidates = (resolvedAnalysis?.extracted_fields || resolvedAnalysis?.fields || [])
    .map((candidate) => ({ ...candidate, _origin: "provider" }));
  const allCandidates = [
    ...analysisCandidates,
    ...deterministic.candidates.map((candidate) => ({ ...candidate, _origin: "deterministic" })),
  ];
  const conflicts = [];
  const facts = {};
  const fieldTrace = {};

  for (const field of claimFieldNames) {
    const rawClaimValue = claim[field === "container_numbers" ? "container_number" : field];
    const candidates = allCandidates.filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .filter((candidate) => isPresent(candidate.normalized_value ?? candidate.value));
    const hasEvidenceConfirmedZero = candidates.some((candidate) => {
      const number = parseNumber(candidate.normalized_value ?? candidate.value);
      return number === 0 && (candidate.sources || []).length > 0;
    });
    const zeroPlaceholder = monetaryClaimFields.has(field) && parseNumber(rawClaimValue) === 0 && !hasEvidenceConfirmedZero;
    const claimValue = isPresent(rawClaimValue) && !zeroPlaceholder ? rawClaimValue : null;
    const resolution = resolveCandidateGroup(field, candidates);
    const evidenceValues = resolution.ranked.map((group) => group.comparable);
    const claimComparable = isPresent(claimValue) ? comparableForField(field, claimValue) : null;
    const distinct = unique(evidenceValues);
    const displayedEvidenceValues = resolution.ranked.map((group) => {
      const candidate = group.items.slice().sort((left, right) => candidateScore(right) - candidateScore(left))[0];
      return candidate?.normalized_value ?? candidate?.value;
    }).filter(isPresent);
    const hasEvidenceConflict = distinct.length > 1;
    const selectedCandidate = resolution.selectedCandidate;
    let selected = selectedCandidate
      ? selectedCandidate.normalized_value ?? selectedCandidate.value
      : claimValue;
    if (selectedCandidate && monetaryClaimFields.has(field) && parseNumber(selected) === 0 && rawClaimValue === 0 && hasEvidenceConfirmedZero) selected = rawClaimValue;
    const sources = resolution.selectedGroup?.items.flatMap((candidate) => candidate.sources || []) || [];
    const metadataMismatch = selectedCandidate && claimComparable && claimComparable !== resolution.selectedGroup?.comparable;
    facts[field] = {
      field,
      value: selected,
      status: hasEvidenceConflict || metadataMismatch ? "conflict" : isPresent(selected) ? "supported" : "requires_confirmation",
      sources,
      candidate_values: displayedEvidenceValues.length ? displayedEvidenceValues : isPresent(claimValue) ? [claimValue] : [],
    };
    fieldTrace[field] = {
      field,
      metadata_value: claimValue,
      metadata_ignored_as_zero_placeholder: zeroPlaceholder,
      candidates: candidates.map((candidate) => ({
        value: candidate.normalized_value ?? candidate.value,
        origin: candidate._origin,
        confidence: candidate.confidence ?? null,
        sources: candidate.sources || [],
      })),
      selected_value: selected,
      resolution: selectedCandidate
        ? hasEvidenceConflict ? "highest-supported evidence candidate; conflicting evidence retained for review" : "evidence-supported candidate"
        : isPresent(claimValue) ? "claim metadata fallback; no evidence candidate was available" : "not established after reviewing all evidence candidates",
      final_status: facts[field].status,
    };
    if (hasEvidenceConflict) conflicts.push({ field, values: displayedEvidenceValues, message: `Conflicting evidence values were found for ${field.replaceAll("_", " ")}: ${displayedEvidenceValues.join(" / ")}. The highest-supported value (${selected}) was retained and all alternatives remain in the field trace.` });
    if (metadataMismatch) conflicts.push({ field, values: [claimValue, selected], message: `Stored claim metadata for ${field.replaceAll("_", " ")} differs from the uploaded evidence. The evidence-supported value (${selected}) was retained.` });
  }

  const inheritFact = (target, source, reason) => {
    if (isPresent(facts[target]?.value) || !isPresent(facts[source]?.value)) return;
    facts[target] = {
      ...facts[target],
      value: facts[source].value,
      status: "supported",
      sources: facts[source].sources || [],
      candidate_values: facts[source].candidate_values || [],
      derived_from: source,
    };
    fieldTrace[target] = {
      ...fieldTrace[target],
      selected_value: facts[source].value,
      resolution: reason,
      final_status: "supported",
    };
  };
  inheritFact("gross_claim_amount", "claim_amount", "mapped from evidence-supported presented claim amount");
  inheritFact("claim_amount", "gross_claim_amount", "mapped from evidence-supported gross presented claim amount");
  inheritFact("container_numbers", "container_number", "mapped from evidence-supported container reference");
  inheritFact("container_number", "container_numbers", "mapped from evidence-supported container references");
  inheritFact("country", "destination_country", "mapped from the evidence-supported destination country");
  inheritFact("date_of_intimation", "notice_date", "mapped from the evidence-supported notice of claim date");

  if (!isPresent(facts.currency.value)) {
    const currency = currencyCode(allCandidates.map((candidate) => candidate.value).join(" "));
    if (currency) facts.currency = { ...facts.currency, value: currency, status: "supported" };
  } else facts.currency.value = currencyCode(facts.currency.value) || facts.currency.value;
  for (const field of ["container_numbers", "seal_numbers"]) {
    const values = unique(allCandidates
      .filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .flatMap((candidate) => String((candidate.normalized_value ?? candidate.value) || "").split(/\s*,\s*/)));
    if (values.length) {
      facts[field] = { ...facts[field], value: values.join(", "), status: "supported", candidate_values: values };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: facts[field].value, resolution: "merged all evidence-supported identifiers", final_status: "supported" };
      const conflictIndex = conflicts.findIndex((conflict) => conflict.field === field);
      if (conflictIndex >= 0) conflicts.splice(conflictIndex, 1);
    }
  }
  for (const field of ["policy_terms", "warranties_conditions", "damage_findings", "temperature_findings"]) {
    const candidates = allCandidates.filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .filter((candidate) => isPresent(candidate.normalized_value ?? candidate.value));
    const values = unique(candidates.map((candidate) => String(candidate.normalized_value ?? candidate.value).replace(/\s+/g, " ").trim()));
    if (!isPresent(claim[field]) && values.length) {
      facts[field] = {
        ...facts[field],
        value: values.join(" — "),
        status: "supported",
        sources: candidates.flatMap((candidate) => candidate.sources || []),
        candidate_values: values,
      };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: facts[field].value, resolution: "merged complementary evidence passages", final_status: "supported" };
      const conflictIndex = conflicts.findIndex((conflict) => conflict.field === field);
      if (conflictIndex >= 0) conflicts.splice(conflictIndex, 1);
    }
  }

  const adjustmentLineItems = [...(resolvedAnalysis?.adjustment_line_items || []), ...(deterministic.adjustmentLineItems || [])].flatMap((item) => {
    const adjustedValue = parseNumber(item.adjusted_value);
    if (!isPresent(item.description) || adjustedValue === null || !(item.sources || []).length) return [];
    return [{
      description: String(item.description).trim(),
      quantity: isPresent(item.quantity) ? String(item.quantity).trim() : null,
      unit_price: parseNumber(item.unit_price),
      adjusted_value: adjustedValue,
      currency: currencyCode(item.currency) || item.currency || null,
      basis: isPresent(item.basis) ? String(item.basis).trim() : null,
      confidence: item.confidence ?? null,
      sources: item.sources,
    }];
  }).filter((item, index, items) => {
    const source = item.sources?.[0] || {};
    const key = `${source.document_id || source.document_name || ""}:${source.page || ""}:${normalizeComparable(item.description)}:${parseNumber(item.adjusted_value)}:${parseNumber(item.quantity)}`;
    return items.findIndex((candidate) => {
      const candidateSource = candidate.sources?.[0] || {};
      return `${candidateSource.document_id || candidateSource.document_name || ""}:${candidateSource.page || ""}:${normalizeComparable(candidate.description)}:${parseNumber(candidate.adjusted_value)}:${parseNumber(candidate.quantity)}` === key;
    }) === index;
  });
  const itemizedClaimTotal = adjustmentLineItems.length
    ? adjustmentLineItems.reduce((total, item) => total + item.adjusted_value, 0)
    : null;
  const itemCurrencies = unique(adjustmentLineItems.map((item) => currencyCode(item.currency) || item.currency).filter(isPresent));
  if (itemCurrencies.length === 1) {
    const itemCurrency = itemCurrencies[0];
    facts.currency = { ...facts.currency, value: itemCurrency, status: "supported", sources: adjustmentLineItems.flatMap((item) => item.sources) };
    fieldTrace.currency = { ...fieldTrace.currency, selected_value: itemCurrency, resolution: "derived from the evidence-reconciled adjustment schedule", final_status: "supported" };
  }
  const explicitPresentedClaim = parseNumber(facts.gross_claim_amount.value) ?? parseNumber(facts.claim_amount.value);
  const presentedClaim = explicitPresentedClaim ?? itemizedClaimTotal;
  if (explicitPresentedClaim === null && itemizedClaimTotal !== null) {
    const formattedTotal = itemizedClaimTotal.toFixed(2);
    for (const field of ["claim_amount", "gross_claim_amount"]) {
      facts[field] = { ...facts[field], value: formattedTotal, status: "supported", sources: adjustmentLineItems.flatMap((item) => item.sources), derived_from: "adjustment_line_items" };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: formattedTotal, resolution: "deterministic sum of evidence-supported adjustment line items", final_status: "supported" };
    }
  }
  const explicitAdjusted = parseNumber(facts.adjusted_amount.value);
  const adjustedClaimAmount = itemizedClaimTotal ?? explicitAdjusted ?? presentedClaim;
  const underlyingAdjustedLoss = itemizedClaimTotal ?? presentedClaim;
  const deductible = evaluateCompoundDeductible(facts.deductible.value, underlyingAdjustedLoss);
  const salvage = parseNumber(facts.salvage_amount.value);
  const recovery = parseNumber(facts.recovery_amount.value);
  const depreciation = parseNumber(facts.depreciation_amount.value);
  const valuationUpliftPercent = parseNumber(facts.valuation_uplift_percent.value);
  const explicitValuationUplift = parseNumber(facts.valuation_uplift_amount.value);
  const valuationUpliftAmount = explicitValuationUplift ?? (underlyingAdjustedLoss !== null && valuationUpliftPercent !== null
    ? Number((underlyingAdjustedLoss * valuationUpliftPercent / 100).toFixed(4))
    : null);
  const calculationBase = underlyingAdjustedLoss === null
    ? null
    : underlyingAdjustedLoss + (valuationUpliftAmount ?? 0);
  const valuationAdjustment = presentedClaim !== null && itemizedClaimTotal !== null ? Number((presentedClaim - itemizedClaimTotal).toFixed(2)) : null;
  const canCalculateWithoutExplicit = calculationBase !== null && [deductible, salvage, recovery, depreciation].every((value) => value !== null);
  const knownDeductions = [deductible, salvage, recovery, depreciation].filter((value) => value !== null);
  const knownCalculated = calculationBase === null
    ? null
    : calculationBase - knownDeductions.reduce((total, value) => total + Math.abs(value), 0);
  const arithmeticValid = explicitAdjusted !== null && knownCalculated !== null ? Math.abs(explicitAdjusted - knownCalculated) <= 0.01 : false;
  const concludedIndemnity = explicitAdjusted ?? (canCalculateWithoutExplicit ? knownCalculated : null);
  const reconciledItemizedAdjustment = itemizedClaimTotal !== null && explicitAdjusted !== null && arithmeticValid;
  const financials = {
    currency: facts.currency.value || null,
    presented_claim: presentedClaim,
    itemized_claim_total: itemizedClaimTotal,
    adjusted_claim_amount: adjustedClaimAmount,
    valuation_adjustment: valuationAdjustment,
    valuation_basis: isPresent(facts.valuation_basis.value) ? facts.valuation_basis.value : null,
    valuation_uplift_percent: valuationUpliftPercent,
    valuation_uplift_amount: valuationUpliftAmount,
    claim_after_valuation_uplift: calculationBase,
    invoice_value: parseNumber(facts.invoice_total.value),
    freight_amount: parseNumber(facts.freight_amount.value),
    insurance_amount: parseNumber(facts.insurance_amount.value),
    fob_value: parseNumber(facts.fob_value.value),
    freight_invoice_value: parseNumber(facts.freight_invoice_total.value),
    policy_premium: parseNumber(facts.policy_premium.value),
    insured_value: parseNumber(facts.insured_value.value) ?? parseNumber(facts.policy_limit.value),
    deductible, salvage, recovery, depreciation,
    provisional_indemnity: knownCalculated,
    concluded_indemnity: concludedIndemnity,
    calculation_status: arithmeticValid || (canCalculateWithoutExplicit && concludedIndemnity !== null)
      ? "validated"
      : explicitAdjusted !== null ? "source_stated_requires_reconciliation" : "requires_confirmation",
    arithmetic_valid: arithmeticValid || (canCalculateWithoutExplicit && explicitAdjusted === null),
    requires_confirmation: [
      presentedClaim === null ? "Presented claim quantum" : null,
      deductible === null ? "Applicable deductible / excess" : null,
      salvage === null && !reconciledItemizedAdjustment ? "Salvage deduction or explicit confirmation that none applies" : null,
      recovery === null && !reconciledItemizedAdjustment ? "Recovery credit or explicit confirmation that none applies" : null,
      depreciation === null && !reconciledItemizedAdjustment ? "Depreciation or explicit confirmation that none applies" : null,
      concludedIndemnity === null ? "Concluded indemnity" : null,
      explicitAdjusted !== null && !arithmeticValid ? "Complete adjustment components needed to reconcile the source-stated concluded indemnity" : null,
    ].filter(Boolean),
  };
  if (explicitAdjusted !== null && knownCalculated !== null && !arithmeticValid) conflicts.push({ field: "adjusted_amount", values: [String(explicitAdjusted), String(knownCalculated)], message: "The stated adjusted amount does not reconcile with the supported presented claim and adjustments." });

  const types = recognizedDocumentTypes(documents, resolvedAnalysis, evidence);
  const outstandingDocuments = template.requiredDocuments.filter((required) => !requirementAliases(required).some((alias) => types.has(alias)));
  const evidenceFindings = [...(resolvedAnalysis?.evidence_findings || []), ...deterministic.findings]
    .filter((finding, index, items) => items.findIndex((item) => normalizeComparable(item.finding) === normalizeComparable(finding.finding)) === index);
  const chronology = buildChronology(facts);
  const validationChecks = buildValidationChecks(facts, financials, chronology);
  if (itemizedClaimTotal !== null) {
    const comparisonAmount = explicitAdjusted ?? presentedClaim;
    const difference = comparisonAmount === null ? 0 : comparisonAmount - itemizedClaimTotal;
    validationChecks.push(validationCheck(
      "claim-schedule-total",
      "Itemized adjusted claim schedule",
      comparisonAmount === null || Math.abs(difference) < 0.01 ? "validated" : "requires_review",
      comparisonAmount === null || Math.abs(difference) < 0.01
        ? `The ${adjustmentLineItems.length} evidence-supported adjusted line item(s) total ${financials.currency || "the stated currency"} ${itemizedClaimTotal.toFixed(2)}${explicitAdjusted !== null ? ", matching the adjusted claim amount" : ""}.`
        : `The evidence-supported adjusted line items total ${financials.currency || "the stated currency"} ${itemizedClaimTotal.toFixed(2)}, differing from the ${explicitAdjusted !== null ? "stated adjusted amount" : "presented claim"} by ${Math.abs(difference).toFixed(2)}.`,
      adjustmentLineItems.flatMap((item) => item.sources),
    ));
  }
  for (const check of validationChecks.filter((item) => item.status === "requires_review")) {
    if (!conflicts.some((conflict) => conflict.field === check.id)) conflicts.push({ field: check.id, values: [], message: check.statement });
  }
  const documentRegister = buildDocumentRegister(documents, evidence, resolvedAnalysis);
  const causeAssessment = buildCauseAssessment(facts, evidenceFindings);
  const policyAnalysis = buildPolicyAnalysis(facts, chronology, validationChecks, evidenceFindings);
  const adjustment = buildAdjustment(financials, validationChecks, adjustmentLineItems);
  const appendices = documentRegister.filter((document) => document.categories.includes("Photographs") || document.image_only_pages > 0);
  return {
    business_line: businessLine,
    template,
    facts,
    field_trace: fieldTrace,
    financials,
    conflicts,
    evidence_findings: evidenceFindings,
    recognized_document_types: [...types],
    outstanding_documents: outstandingDocuments,
    chronology,
    validation_checks: validationChecks,
    cause_assessment: causeAssessment,
    policy_analysis: policyAnalysis,
    adjustment,
    document_register: documentRegister,
    appendices,
    evidence,
  };
}

const amountText = (value, currency) => {
  const number = parseNumber(value);
  if (number === null || !isPresent(currency)) return REQUIRES_CONFIRMATION;
  return `${currency} ${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const evidenceIndex = (record) => new Map(record.evidence.map((item, index) => [item.document_id, `E-${String(index + 1).padStart(2, "0")}`]));
const citation = (fact, index) => {
  const labels = unique((fact?.sources || []).map((source) => {
    const id = index.get(source.document_id) || source.document_name;
    return source.page ? `${id}, p. ${source.page}` : id;
  }));
  return labels.length ? ` [Source: ${labels.join("; ")}]` : "";
};
const factText = (record, field, index) => {
  const fact = record.facts[field];
  if (!fact || !isPresent(fact.value)) return REQUIRES_CONFIRMATION;
  return `${fact.value}${citation(fact, index)}${fact.status === "conflict" ? " [Conflict — human review required]" : ""}`;
};
const tableRows = (record, index, rows) => rows.map(([label, field]) => `| ${label} | ${factText(record, field, index)} |`).join("\n");
const statusText = (status) => ({
  validated: "Validated",
  requires_review: "Requires professional review",
  not_testable: "Not testable from current evidence",
  evidence_available_for_review: "Evidence available for review",
  compliance_requires_review: "Compliance requires review",
}[status] || String(status || "Review required").replaceAll("_", " "));

const conciseText = (value, length = 480) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length).trim()}...` : text;
};
const corporateSection = `**United Loss Adjusters & Surveyors (ULA)** provides independent international loss adjusting, surveying, technical, legal-support, and claims-management services.

This controlled draft is prepared for professional review. ULA contact and legal-entity details are presented through the approved report template and must be confirmed for the issuing office.`;

export function createUnifiedReportDraft({ claim, documents, versions, generatedBy, analysis = null, evidence = [] }) {
  const normalizedRecord = buildNormalizedClaimRecord({ claim, documents, analysis, evidence });
  const template = normalizedRecord.template;
  const normalizedClaimValues = Object.fromEntries(Object.entries(normalizedRecord.facts)
    .filter(([, fact]) => fact.status !== "requires_confirmation" && isPresent(fact.value))
    .map(([field, fact]) => [field, fact.value]));
  const readiness = reportReadiness({ ...claim, ...normalizedClaimValues, business_line: normalizedRecord.business_line }, documents);
  readiness.missingDocuments = normalizedRecord.outstanding_documents;
  const assignments = reportAssignments(claim, generatedBy);
  const versionNumber = versions.reduce((highest, version) => Math.max(highest, Number(version.version_number) || 0), 0) + 1;
  const issueDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const index = evidenceIndex(normalizedRecord);
  const facts = normalizedRecord.facts;
  const financials = normalizedRecord.financials;
  const currency = financials.currency;
  const applicantField = isPresent(facts.applicant?.value) ? "applicant" : "insurer";

  const supportingDocuments = normalizedRecord.document_register.length
    ? normalizedRecord.document_register.map((document, documentIndex) => {
      const evidenceId = index.get(document.document_id) || `E-${String(documentIndex + 1).padStart(2, "0")}`;
      const categories = document.categories.length ? document.categories.join(", ") : "No substantive document category established";
      const extraction = document.extracted_length
        ? `${document.extracted_length.toLocaleString()} extracted characters across ${document.searchable_pages} searchable page(s)`
        : `${document.image_only_pages} image-only page(s); no searchable text retained`;
      return `- **${evidenceId} - ${document.document_name}**: ${categories}; ${extraction}.`;
    }).join("\n")
    : "- No uploaded evidence file is registered for this claim.";
  const outstandingDocuments = normalizedRecord.outstanding_documents.length
    ? normalizedRecord.outstanding_documents.map((item) => `- **${item}** — substantive evidence was not established across the uploaded file set.`).join("\n")
    : "- No template-required document category is presently outstanding; substantive sufficiency remains subject to human review.";
  const chronologyRows = normalizedRecord.chronology.length
    ? normalizedRecord.chronology.map((event, eventIndex) => `| ${eventIndex + 1} | ${event.date} | ${event.label}${citation(event, index)} |`).join("\n")
    : `| - | ${REQUIRES_CONFIRMATION} | No dated event was established from the evidence. |`;
  const evidenceFindings = normalizedRecord.evidence_findings.length
    ? normalizedRecord.evidence_findings.map((finding, findingIndex) => `${findingIndex + 1}. ${conciseText(finding.finding, 700)}${citation({ sources: finding.sources || [] }, index)}`).join("\n")
    : "No substantive investigation finding was retained from the uploaded evidence.";
  const findings = `### Evidence chronology\n\n| Sequence | Date | Evidence-linked event |\n| ---: | --- | --- |\n${chronologyRows}\n\n### Survey / investigation findings\n\n${evidenceFindings}`;
  const validationRows = normalizedRecord.validation_checks.length
    ? normalizedRecord.validation_checks.map((check) => `| ${check.label} | ${statusText(check.status)} | ${check.statement}${citation(check, index)} |`).join("\n")
    : "| Evidence reconciliation | Not testable from current evidence | No cross-document or arithmetic validation could be completed. |";
  const policyRows = normalizedRecord.policy_analysis.entries.length
    ? normalizedRecord.policy_analysis.entries.map((entry) => `| ${entry.topic} | ${statusText(entry.status)} | ${entry.assessment}${citation(entry, index)} |`).join("\n")
    : "| Policy clauses / warranties | Not established | No substantive policy wording was retained in the normalized evidence. |";

  const financialRows = [
    ["Presented claim / gross quantum", financials.presented_claim],
    ["Documented invoice value (not automatically the claim quantum)", financials.invoice_value],
    ["Freight amount in commercial invoice", financials.freight_amount],
    ["Insurance amount in commercial invoice", financials.insurance_amount],
    ["FOB value in commercial invoice", financials.fob_value],
    ["Documented freight invoice (not automatically claimable)", financials.freight_invoice_value],
    ["Policy valuation uplift", financials.valuation_uplift_amount],
    ["Claim after policy valuation uplift", financials.claim_after_valuation_uplift],
    ["Applicable deductible / excess", financials.deductible],
    ["Salvage deduction", financials.salvage],
    ["Recovery credit", financials.recovery],
    ["Depreciation", financials.depreciation],
    ["Provisional amount after supported adjustments", financials.provisional_indemnity],
    ["Concluded indemnity", financials.concluded_indemnity],
  ].map(([label, value]) => `| ${label} | ${amountText(value, currency)} |`).join("\n");
  const financialNarrative = financials.arithmetic_valid
    ? `The supported figures reconcile arithmetically to **${amountText(financials.concluded_indemnity, currency)}**. The calculation is deterministic; coverage and payment authority remain subject to professional review.`
    : financials.concluded_indemnity !== null
      ? `The evidence states a concluded amount of **${amountText(financials.concluded_indemnity, currency)}**, but the available adjustment components do not fully reproduce it. It is retained as source-stated, not arithmetic-validated. Unresolved evidence items: ${financials.requires_confirmation.join("; ")}.`
      : financials.provisional_indemnity !== null
        ? `The evidenced arithmetic produces a provisional amount of **${amountText(financials.provisional_indemnity, currency)}** after the supported valuation uplift and deductions. It is not presented as a concluded indemnity because the remaining adjustment and coverage matters require confirmation: ${financials.requires_confirmation.join("; ") || REQUIRES_CONFIRMATION}.`
        : `A concluded indemnity cannot yet be calculated without assumptions. Evidence not established across the reviewed file set: ${financials.requires_confirmation.join("; ") || REQUIRES_CONFIRMATION}. Invoice or insured values have not been substituted for a presented claim.`;
  const policyLimit = parseNumber(facts.insured_value.value) ?? parseNumber(facts.policy_limit.value);
  const invoiceValue = financials.invoice_value;
  const adequacy = policyLimit !== null && invoiceValue !== null
    ? `The documented insured value / policy limit is **${amountText(policyLimit, currency)}** and the documented invoice value is **${amountText(invoiceValue, currency)}**. The difference is **${amountText(policyLimit - invoiceValue, currency)}** and the invoice represents **${(invoiceValue / policyLimit * 100).toFixed(2)}%** of that value / limit. The arithmetic is validated, but the applicable valuation basis and any underinsurance consequence remain matters for professional review.${citation(isPresent(facts.insured_value.value) ? facts.insured_value : facts.policy_limit, index)}`
    : `${REQUIRES_CONFIRMATION}. The evidence does not establish both a comparable insured value and invoice value.`;

  const causeBody = (() => {
    const assessment = normalizedRecord.cause_assessment;
    const observations = assessment.observations.length
      ? assessment.observations.map((finding) => `- ${conciseText(finding.finding)}${citation(finding, index)}`).join("\n")
      : "- The normalized evidence contains no specific physical-condition observation from which causation can be assessed.";
    const indicators = assessment.indicators.length
      ? assessment.indicators.map((finding) => `- ${conciseText(finding.finding)}${citation(finding, index)}`).join("\n")
      : "- No distinct causal indicator was established in the normalized evidence.";
    const conclusion = assessment.explicit_cause
      ? `The source evidence expressly records: **${factText(normalizedRecord, "cause_of_loss", index)}**. This is retained as the evidence-stated cause and remains subject to professional proximate-cause and coverage review.`
      : `${assessment.evidence_gap}${citation({ sources: assessment.inference_sources || [] }, index)}`;
    return `### Observed condition\n\n${observations}\n\n### Causal indicators in the evidence\n\n${indicators}\n\n### Cause assessment\n\n${conclusion}`;
  })();

  const appendixBody = normalizedRecord.appendices.length
    ? normalizedRecord.appendices.map((document, appendixIndex) => {
      const evidenceId = index.get(document.document_id) || document.document_name;
      const linkedFindings = normalizedRecord.evidence_findings.filter((finding) => (finding.sources || []).some((source) => source.document_id === document.document_id));
      const description = linkedFindings.length
        ? linkedFindings.map((finding) => conciseText(finding.finding, 220)).join("; ")
        : "Photographic or image-only evidence is registered, but no evidence-supported caption was retained.";
      return `- **Appendix A-${String(appendixIndex + 1).padStart(2, "0")} (${evidenceId}) - ${document.document_name}:** ${description}`;
    }).join("\n")
    : "- No photographic or image-only evidence was established in the uploaded file set.";
  const reportedCondition = isPresent(facts.cause_of_loss.value)
    ? factText(normalizedRecord, "cause_of_loss", index)
    : normalizedRecord.cause_assessment.observations[0]
      ? `${conciseText(normalizedRecord.cause_assessment.observations[0].finding)}${citation(normalizedRecord.cause_assessment.observations[0], index)}`
      : "No evidence-supported loss condition was retained.";
  const reviewStatements = normalizedRecord.conflicts.length
    ? normalizedRecord.conflicts.map((conflict) => `- ${conflict.message}`).join("\n")
    : "- No scalar or deterministic reconciliation conflict was detected in the normalized record.";
  const masterData = buildMasterReportData({
    report: {
      normalized_claim_record: normalizedRecord,
      assignments,
      version_number: versionNumber,
      issue_date: issueDate,
      notes: "Initial controlled draft",
    },
    claim,
    issueDate,
  });
  const masterParagraphs = (name) => (masterData.paragraphs[name] || []).join("\n\n");
  const masterList = (name) => (masterData.paragraphs[name] || []).map((item) => `- ${item}`).join("\n") || `- ${REQUIRES_CONFIRMATION}`;
  const damageSchedule = masterData.damage_rows.length
    ? `\n\n| Description | Boxes / Quantity | Packing |\n| --- | ---: | --- |\n${masterData.damage_rows.map((row) => `| ${row.damage_description} | ${row.damage_quantity} | ${row.damage_packing} |`).join("\n")}`
    : "";
  const adjustmentSchedule = masterData.adjustment_rows.map((row) => `| ${row.adjustment_description} | ${row.adjustment_quantity} | ${row.adjustment_unit_price} | ${row.adjustment_value} |`).join("\n");

  const sectionBody = (section) => {
    switch (section.id) {
      case "executive_summary":
        return `${masterParagraphs("report_summary_intro")}\n\n| Assured's / Shipper's Name | ${masterData.scalars.summary_assured} |\n| --- | --- |\n| Consignee's Name | ${masterData.scalars.summary_consignee} |\n| Insurance Policy | ${masterData.scalars.summary_policy.replaceAll("\n", "<br>")} |\n\nThe following was concluded:\n\n${masterParagraphs("report_summary_findings")}\n\n### In our opinion,\n\n${masterList("report_summary_opinion")}\n\n${masterParagraphs("document_sighting")}`;
      case "introduction":
      case "appointment":
        return `ULA's appointment or instruction details: **${factText(normalizedRecord, "appointment_details", index)}**\n\nThe available file identifies the applicant / instructing party as **${factText(normalizedRecord, applicantField, index)}**, the insurer as **${factText(normalizedRecord, "insurer", index)}**, the insured / assured as **${factText(normalizedRecord, "insured", index)}**, and the relevant transit interest as **${factText(normalizedRecord, "commodity", index)}**. No wider scope or authority is inferred beyond the uploaded evidence.`;
      case "investigation": case "surveyor_notes": case "survey_timeline": case "adjusters_note":
        return `${masterParagraphs("surveyor_notes")}${damageSchedule}`;
      case "interest_insured":
        return masterParagraphs("interest_insured");
      case "routing": case "transport":
        return `| Routing detail | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Country of origin", "country_of_origin"], ["Origin / loading", isPresent(facts.voyage_from.value) ? "voyage_from" : "port_of_loading"], ["Destination country", "destination_country"], ["Destination / discharge", isPresent(facts.voyage_to.value) ? "voyage_to" : "port_of_discharge"], ["Mother vessel", "vessel_name"], ["Mother-vessel voyage", "voyage_number"], ["Transshipment port", "transshipment_port"], ["Feeder vessel", "feeder_vessel"], ["Feeder voyage", "feeder_voyage"], ["Carrier", "carrier"], ["Departure date", "departure_date"], ["Arrival date", "arrival_date"], ["Shipment / on-board date", "shipment_date"], ["Bill of lading", "bill_of_lading"], ["Container(s)", "container_numbers"], ["Seal(s)", "seal_numbers"], ["Seal condition", "seal_condition"]])}`;
      case "temperature":
        return `| Cold-chain fact | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Required carrying temperature", "temperature_requirement"], ["Affected container", "affected_container"], ["Affected shipment quantity", "affected_quantity"], ["Commercially unacceptable / salvage-suitable quantity", "salvage_quantity"], ["Total-loss quantity", "total_loss_quantity"], ["Recorded temperature findings", "temperature_findings"], ["Survey findings", "damage_findings"]])}\n\nTemperature records are treated as outstanding unless substantive logger readings or equivalent records are present. A policy temperature condition alone is not a temperature record.`;
      case "cause":
        return masterParagraphs("cause_of_loss_section");
      case "coverage": case "warranties":
        return masterParagraphs("policy_conditions_section");
      case "assessors":
        return masterParagraphs("assessors_section");
      case "insured_value": case "sums_insured": return masterParagraphs("adequacy_section");
      case "adjustment": return `${masterParagraphs("adjustment_intro")}\n\n### Table 2 - Claim presented by the Assured & Adjustment\n\n| Description | Quantity damaged | Unit Price in ${masterData.scalars.currency} | Adjusted Claim Value in ${masterData.scalars.currency} |\n| --- | ---: | ---: | ---: |\n${adjustmentSchedule}\n\n${masterData.scalars.adjustment_total.replaceAll("\n", "  \n")}`;
      case "conclusion":
        return `In our opinion,\n\n${masterList("conclusion_items")}\n\n${masterParagraphs("document_sighting")}\n\nEnd of adjustment note.`;
      case "supporting_documents": return masterList("enclosure_items");
      case "outstanding_documents": return masterList("outstanding_items");
      case "appendices": return masterData.appendices.length ? masterData.appendices.map((entry) => `### ${entry.heading}\n\n${entry.description}`).join("\n\n") : "No appendix evidence was established in the uploaded file set.";
      case "notice": case "notices":
        return `| Notice detail | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Date of intimation", "date_of_intimation"], ["Notice of claim date", "notice_date"], ["Carrier", "carrier"], ["Bill of lading", "bill_of_lading"], ["Air waybill", "air_waybill"]])}`;
      case "timing": return `${findings}\n\nThe event sequence is evidential, not a determination of when physical damage occurred. Any unsupported damage timing remains open for professional review.`;
      case "weather": return "No weather report or voyage-weather record was identified in the normalized evidence. No weather-related cause is inferred.";
      case "recovery":
        return `| Recovery matter | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Salvage findings", "salvage_findings"], ["Salvage amount", "salvage_amount"], ["Recovery findings", "recovery_findings"], ["Recovery amount", "recovery_amount"]])}\n\nUnknown salvage or recovery is not treated as zero.`;
      case "corporate": return corporateSection;
      case "contents": return uniqueSections(template.sections).filter((item) => !["cover", "document_control", "contents"].includes(item.id)).map((item, itemIndex) => `${itemIndex + 1}. ${item.title}`).join("\n");
      default: return `${REQUIRES_CONFIRMATION}. No evidence-grounded content is available for this specialist section.`;
    }
  };

  const responsibility = Object.fromEntries(assignments.map((assignment) => [assignment.role, assignment]));
  const salientRows = [
    ["Applicant's Name", masterData.scalars.insurer],
    ["Assured's Name", masterData.scalars.insured_name],
    ["Insurance Policy", masterData.scalars.policy_details.replaceAll("\n", "<br>")],
    ["Incoterm / Terms of sale", masterData.scalars.incoterm],
    ["Transport Document", masterData.scalars.transport_document],
    ["Shipper's Name", masterData.scalars.shipper],
    ["Consignee's Name", masterData.scalars.consignee],
    ["Cargo / Commodities", masterData.scalars.cargo_details],
    ["Origin / Destination", masterData.scalars.routing_details],
    ["Carrying Vessel / Carrier", masterData.scalars.carrier_details],
    ["Cargo Arrival / Delivery Date", masterData.scalars.arrival_delivery_details],
  ].map(([label, value]) => `| ${label} | ${value} |`).join("\n");
  const bodySections = uniqueSections(template.sections)
    .filter((section) => !["cover", "document_control", "version_history", "executive_summary", "claim_facts"].includes(section.id))
    .map((section) => `## ${section.title}\n\n${sectionBody(section)}`).join("\n\n");
  const content = `# ${masterData.scalars.cover_title}

## Cover Page

- **ULA reference:** ${masterData.scalars.claim_number} - ${masterData.scalars.version_number}v1
- **Applicant's Name:** ${masterData.scalars.insurer}
- **Assured's Name:** ${masterData.scalars.insured_name}
- **Policy No.:** ${masterData.scalars.policy_number}
- **Date:** ${masterData.scalars.issue_date}

## Document Control Page

| Written by: | Reviewed by: | Approved by: |
| --- | --- | --- |
| ${responsibility.preparer?.name || "Not assigned"} | ${responsibility.reviewer?.name || "Not assigned"} | ${responsibility.approver?.name || "Not assigned"} |
| Designation: | Designation: | Designation: |
| ${responsibility.preparer?.designation || "Not assigned"} | ${responsibility.reviewer?.designation || "Not assigned"} | ${responsibility.approver?.designation || "Not assigned"} |
| Signature (Approver) |  |  |
| This survey and its issued report were completed without prejudice to all rights of parties concerned. |  |  |
| Date of approval |  |  |
| ${masterData.scalars.issue_date} |  |  |

### Version History

| Version History | Date of issue | Reason for Revision |
| --- | --- | --- |
| ${versionNumber} | ${issueDate} | ${masterData.scalars.revision_reason} |

The contents of this report are for the confidential information of the client.

This survey and its issued report were completed without prejudice to all rights of parties concerned and its concluded adjustment is in accordance with the terms and conditions of the relevant insurance policy.

## Report Summary

${sectionBody({ id: "executive_summary" })}

## Report and adjustment note

${masterParagraphs("report_note_intro")}

### Table 1 - Summary and salient details

| Claim detail | Evidence-supported value |
| --- | --- |
${salientRows}

${bodySections}
`;
  return { template, assignments, readiness, versionNumber, issueDate, normalizedRecord, content };
}
