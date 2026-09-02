import {
  getReportTemplate,
  reportAssignments,
  reportReadiness,
} from "./reportTemplates.js";
import { buildMasterReportData, sanitizeReportValue } from "./masterReportDocx.js";

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
  const negative = /^\s*\(/.test(String(value));
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
};

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
  "master_bill_of_lading", "house_bill_of_lading",
  "packing_list_number", "purchase_order", "voyage_number", "feeder_voyage", "container_number", "affected_container",
]);
const comparableForField = (field, value) => {
  if (["applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "shipper", "consignee", "carrier"].includes(field)) return normalizeEntityComparable(value);
  if (dateFields.has(field)) return dateComparable(value);
  if (identifierFields.has(field)) return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalizeComparable(value);
};

const NUMBER_WORDS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
  ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19],
  ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90],
]);

const parseEnglishAmountWords = (value) => {
  const text = String(value || "").toLowerCase().replace(/-/g, " ");
  const fraction = Number(text.match(/\b([0-9]{1,2})\s*\/\s*100\b/)?.[1] || 0) / 100;
  const tokens = text.match(/[a-z]+/g) || [];
  let total = 0;
  let group = 0;
  let recognized = 0;
  for (const token of tokens) {
    if (token === "and" || token === "only") continue;
    if (NUMBER_WORDS.has(token)) {
      group += NUMBER_WORDS.get(token);
      recognized += 1;
    } else if (token === "hundred") {
      group = Math.max(1, group) * 100;
      recognized += 1;
    } else if (token === "thousand" || token === "million" || token === "billion") {
      const multiplier = token === "thousand" ? 1_000 : token === "million" ? 1_000_000 : 1_000_000_000;
      total += Math.max(1, group) * multiplier;
      group = 0;
      recognized += 1;
    }
  }
  if (recognized < 2) return null;
  const result = total + group + fraction;
  return Number.isFinite(result) ? Number(result.toFixed(2)) : null;
};

// Quantity fields frequently contain alternative units or conflicting source values
// (for example, "1,045 cartons / 915 pcs"). Treat only one atomic numeric value as
// calculable so separate evidence is never concatenated into a fictitious quantity.
const parseAtomicQuantity = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!isPresent(value)) return null;
  const text = String(value).trim();
  const matches = text.match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
  if (matches.length !== 1 || /\d\s*\+\s*\d|\d\s*\/\s*\d/.test(text)) return null;
  const parsed = Number(matches[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const entityFields = new Set([
  "applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "shipper", "consignee", "carrier", "surveyor",
]);
const ISO_6346_LETTER_VALUES = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24,
  N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
const normalizeContainerNumber = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const validContainerNumber = (value) => {
  const token = normalizeContainerNumber(value);
  if (!/^[A-Z]{4}\d{7}$/.test(token)) return false;
  const weighted = token.slice(0, 10).split("").reduce((total, character, index) => {
    const numeric = /\d/.test(character) ? Number(character) : ISO_6346_LETTER_VALUES[character];
    return total + numeric * (2 ** index);
  }, 0);
  return (weighted % 11) % 10 === Number(token.at(-1));
};
const extractContainerNumbers = (value) => unique(
  String(value || "").toUpperCase().match(/\b[A-Z]{4}[\s-]*\d{7}\b/g)?.map(normalizeContainerNumber) || [],
);
const entityContaminationPattern = /(?:wooden\s+pack(?:age|ing)|not\s+applicable\s*\(?(?:not\s+used)?\)?|carrier'?s? agents? endorsements?|place\s+of\s+del\s*iv\s*ery|multimodal\s+t\s*r\s*ansport|applicable\s+only\s+when|terms?\s+and\s+conditions?|warrant(?:ed|y|ies)?|exclud(?:ed|ing|sion)|bill\s+of\s+lading\s+(?:terms?|conditions?)|received\s+for\s+shipment|freight\s+(?:payable|prepaid)|copy\s+non-negotiable|original\s+bill|^(?:[a-z]|\d+)[.)]\s+|\b(?:shall|must|may)\s+(?:be|have|pay|remain)\b|\b(?:even though|provided that|in the event that|subject to the following)\b|\b(?:bairro|cep|exported by|export references|phone|fax|e-?mail|address)\b\s*:)/i;
const normalizedCandidate = (candidate) => {
  const policyValue = String(candidate.normalized_value ?? candidate.value ?? "").replace(/\s+/g, " ").trim();
  if (candidate.field === "policy_exclusions" && /^warrant(?:ed|y|ies)\b/i.test(policyValue)) {
    return normalizedCandidate({ ...candidate, field: "policy_warranties", _reclassified_from: "policy_exclusions" });
  }
  if (["policy_warranties", "policy_conditions"].includes(candidate.field) && /^exclud(?:ed|ing|sion)\b/i.test(policyValue)) {
    return normalizedCandidate({ ...candidate, field: "policy_exclusions", _reclassified_from: candidate.field });
  }
  if (candidate.field === "incoterm") {
    const rawValue = String(candidate.normalized_value ?? candidate.value ?? "").trim();
    const match = rawValue.match(/\b(CIF|FOB|CFR|EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS)\b/i);
    if (!match) return { ...candidate, value: null, normalized_value: null, requires_confirmation: true, _rejected_reason: "incoterm field did not contain a recognized Incoterms code" };
    return { ...candidate, value: match[1].toUpperCase(), normalized_value: match[1].toUpperCase() };
  }
  if (candidate.field === "terms_of_sale") {
    const rawValue = sanitizeReportValue(candidate.normalized_value ?? candidate.value, candidate.field);
    if (!rawValue || /^\s*\d+[.)]\s*(?:delivery order|packing list|commercial invoice|bill of lading|air waybill|survey report)\b/i.test(rawValue)) {
      return { ...candidate, value: null, normalized_value: null, requires_confirmation: true, _rejected_reason: "terms of sale field contained a numbered document heading" };
    }
    return { ...candidate, value: rawValue, normalized_value: rawValue };
  }
  if (candidate.field === "valuation_basis") {
    const rawValue = String(candidate.normalized_value ?? candidate.value ?? "").replace(/\s+/g, " ").trim();
    const sourceText = (candidate.sources || []).map((source) => source.supporting_text || "").join(" ");
    if (/^(?:CIF|FOB|CFR|EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS)$/i.test(rawValue)
      && !/\b(?:basis\s+of\s+valuation|valu(?:ation|ed)|invoice\s+value\s+plus|uplift)\b/i.test(sourceText)) {
      return { ...candidate, value: null, normalized_value: null, requires_confirmation: true, _rejected_reason: "Incoterm was not treated as an insurance valuation basis" };
    }
  }
  if (!entityFields.has(candidate.field)) return candidate;
  const rawValue = candidate.normalized_value ?? candidate.value;
  const cleanValue = sanitizeReportValue(rawValue, candidate.field);
  if (!cleanValue || cleanValue.length > 180 || entityContaminationPattern.test(cleanValue)) {
    return { ...candidate, value: null, normalized_value: null, requires_confirmation: true, _rejected_reason: "role field contained boilerplate or OCR contamination" };
  }
  return { ...candidate, value: cleanValue, normalized_value: cleanValue };
};

export const sanitizeSuggestedClaimValue = (field, value) => {
  if (!isPresent(value)) return null;
  const normalized = normalizedCandidate({ field, value, normalized_value: value, requires_confirmation: false });
  return normalized.requires_confirmation ? null : normalized.normalized_value ?? normalized.value;
};

const nonClaimValuationPattern = /^(?:total\s+)?(?:policy\s+limit|sum\s+insured|(?:claimed\s+)?insured\s+(?:shipment\s+)?value|shipment\s+value|commercial\s+invoice\s+(?:total|value)|invoice\s+(?:total|value)|fob\s+value|freight\s+invoice\s+(?:total|value)|policy\s+premium|basis\s+of\s+valuation|max(?:imum)?\s+limit)(?:\b|\s*[-:])/i;
const validAdjustmentLineItem = (item) => {
  const description = String(item?.description || "").replace(/\s+/g, " ").trim();
  const basis = String(item?.basis || "").replace(/\s+/g, " ").trim();
  const combined = `${description} ${basis}`;
  if (!description || nonClaimValuationPattern.test(description)) return false;
  if (/\b(?:policy limit|sum insured|(?:claimed\s+)?insured (?:shipment )?value|full shipment value|commercial invoice total|invoice total for (?:the )?(?:entire|full) shipment|all \d+ containers?)\b/i.test(combined)) return false;
  if (/\bprovisional\b/i.test(combined) && /\b(?:affected|damaged|loss)\b.{0,80}\b(?:to be determined|not established|pending survey)\b/i.test(combined)) return false;
  if (/\b(?:policy limit|sum insured|insured shipment value|full shipment value)\b/i.test(combined)
    && !/\b(?:damaged|missing|shortage|repair|replacement|loss|fee|cost|deduct)/i.test(description)) return false;
  return true;
};

const quotationEvidencePattern = /\b(?:quotation|quote|estimate|estimated|pro[ -]?forma|proposal|supplier offer|repair offer)\b/i;
const provisionalEvidencePattern = /\b(?:provisional|subject to (?:verification|reconciliation)|survey(?:or)?(?:'s)? estimate|estimated amount of loss|by extrapolation|not independently (?:verified|counted)|miscellaneous expenses?)\b/i;
const quotationBasedItem = (item) => quotationEvidencePattern.test([
  item?.description,
  item?.basis,
  ...(item?.sources || []).flatMap((source) => [source.document_name, source.supporting_text]),
].filter(Boolean).join(" "));

const provisionalItem = (item) => provisionalEvidencePattern.test([
  item?.description,
  item?.basis,
  ...(item?.sources || []).flatMap((source) => [source.document_name, source.supporting_text]),
].filter(Boolean).join(" "));

const factBasedOnlyOnQuotation = (fact) => Boolean((fact?.sources || []).length)
  && (fact.sources || []).every((source) => quotationEvidencePattern.test(`${source.document_name || ""} ${source.supporting_text || ""}`));

const factBasedOnlyOnProvisionalEvidence = (fact) => Boolean((fact?.sources || []).length)
  && (fact.sources || []).every((source) => provisionalEvidencePattern.test(`${source.document_name || ""} ${source.supporting_text || ""}`));

const normalizedAdjustmentUnit = (value) => {
  const text = String(value || "").toLowerCase();
  if (/\b(?:kg|kgs|kilogram|kilograms|kilo)\b/.test(text)) return "kg";
  if (/\b(?:carton|cartons|box|boxes)\b/.test(text)) return "package";
  if (/\b(?:unit|units|item|items|piece|pieces|pcs)\b/.test(text)) return "unit";
  if (/\b(?:tonne|tonnes|metric ton|metric tons|mt)\b/.test(text)) return "tonne";
  return null;
};

const deterministicAdjustmentValue = (item) => {
  const sourceValue = parseNumber(item?.adjusted_value);
  if (sourceValue !== null) return { value: sourceValue, derived: false };
  const quantityText = String(item?.quantity || "").replace(/,/g, "");
  const priceText = String(item?.unit_price || "");
  const conversion = quantityText.match(/\b(\d+(?:\.\d+)?)\s*(?:cartons?|boxes?|packages?|units?|items?|pieces?|pcs)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|kilo|units?|items?|pieces?|pcs)\s*(?:\/|per)\s*(?:carton|box|package|unit|item|piece)?/i);
  let quantity;
  let quantityUnit;
  if (conversion) {
    quantity = Number(conversion[1]) * Number(conversion[2]);
    quantityUnit = normalizedAdjustmentUnit(conversion[3]);
  } else {
    const atomic = quantityText.match(/^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)?\s*$/);
    if (!atomic) return { value: null, derived: false };
    quantity = Number(atomic[1]);
    quantityUnit = normalizedAdjustmentUnit(atomic[2]);
  }
  const unitPrice = parseNumber(priceText);
  const priceUnit = normalizedAdjustmentUnit(priceText.match(/(?:\/|per)\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i)?.[1]);
  if (!Number.isFinite(quantity) || unitPrice === null || !quantityUnit || quantityUnit !== priceUnit) return { value: null, derived: false };
  return { value: Number((quantity * unitPrice).toFixed(4)), derived: true };
};

const deductionLineKind = (item) => {
  const text = `${item?.description || ""} ${item?.basis || ""}`;
  if (/\b(?:deductible|policy excess|excess applicable)\b/i.test(text)) return "deductible";
  if (/\b(?:less\s+salvage|salvage\s+(?:deduction|credit|value|proceeds?|realisation))\b/i.test(text)
    || /^\s*salvage\s*$/i.test(String(item?.description || ""))) return "salvage";
  if (/\b(?:recovery|subrogation)\b/i.test(text)) return "recovery";
  if (/\b(?:depreciation|betterment)\b/i.test(text)) return "depreciation";
  return null;
};

const deductibleMoney = (text, label) => {
  const match = String(text || "").match(new RegExp(`\\b${label}\\b(?:\\s+(?:amount|of))?\\s*(?::|is|of)?\\s*(?:USD|USDF|FUS|EUR|GBP|AED|LBP|CAD|AUD|CHF|JPY|[$â‚¬Â£])?\\s*([0-9][0-9,.]*)`, "i"));
  return match ? parseNumber(match[1]) : null;
};

const parseDeductibleTerms = (text, documentedAmount = null) => {
  const wording = String(text || "").replace(/\s+/g, " ").trim();
  const selectedFixedMatch = wording.match(/\b(?:containeri[sz]ed|air|land|road|sea|each\s+and\s+every\s+loss)\b[^.;\n]{0,80}?(?:USD|USDF|FUS|EUR|GBP|AED|LBP|CAD|AUD|CHF|JPY)\s*([0-9][0-9,.]*)/i);
  const selectedFixed = parseNumber(selectedFixedMatch?.[1]);
  if (selectedFixed !== null && documentedAmount !== null && Math.abs(selectedFixed - documentedAmount) <= 0.01) {
    return {
      wording: wording || null,
      currency: currencyCode(selectedFixedMatch[0]) || currencyCode(wording),
      percentage: null,
      minimum: null,
      maximum: null,
      fixed: documentedAmount,
      aggregate: false,
      franchise: false,
    };
  }
  const percentageMatch = wording.match(/\b([0-9]+(?:\.[0-9]+)?)\s*%/);
  const percentage = percentageMatch ? Number(percentageMatch[1]) : null;
  const minimum = deductibleMoney(wording, "min(?:imum)?") ?? deductibleMoney(wording, "not less than");
  const maximum = deductibleMoney(wording, "max(?:imum)?") ?? deductibleMoney(wording, "not more than");
  const aggregate = /\b(?:annual\s+)?aggregate\s+(?:deductible|excess)|\b(?:deductible|excess)\s+on\s+an\s+aggregate\s+basis\b/i.test(wording);
  const franchise = /\bfranchise\b/i.test(wording);
  const fixed = percentage === null && minimum === null && maximum === null && !aggregate
    ? documentedAmount
    : null;
  return {
    wording: wording || null,
    currency: currencyCode(wording),
    percentage,
    minimum,
    maximum,
    fixed,
    aggregate,
    franchise,
  };
};

const applicableDeductible = ({ terms, calculationBase, documentedAmount, explicitLineAmount, claimCurrency }) => {
  if (explicitLineAmount !== null) return explicitLineAmount;
  if (terms.aggregate || terms.franchise) return null;
  if (terms.currency && claimCurrency && terms.currency !== claimCurrency) return null;
  if (terms.percentage !== null) {
    if (calculationBase === null) return null;
    let calculated = calculationBase * terms.percentage / 100;
    if (terms.minimum !== null) calculated = Math.max(calculated, terms.minimum);
    if (terms.maximum !== null) calculated = Math.min(calculated, terms.maximum);
    return Number(calculated.toFixed(4));
  }
  if (terms.minimum !== null || terms.maximum !== null) return null;
  return terms.fixed ?? documentedAmount;
};

const POLICY_TEXT_FIELDS = new Set([
  "policy_terms", "policy_transit_scope", "policy_conveyance_limits", "policy_extensions",
  "policy_warranties", "policy_conditions", "policy_exclusions", "warranties_conditions",
]);

const incompletePolicyFragment = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const openParentheses = (text.match(/\(/g) || []).length;
  const closeParentheses = (text.match(/\)/g) || []).length;
  return !text
    || /[,;:]$/.test(text)
    || openParentheses !== closeParentheses
    || /\b(?:pol|insur|exclu|inclu|condit|warran|applic|jurisdict|respectiv)$/i.test(text)
    || /\b(?:and|or|and\/or|to and\/or|from and\/or|via and\/or)$/i.test(text);
};

const completePolicyValues = (values) => {
  const complete = unique(values.filter((value) => !incompletePolicyFragment(value)));
  return complete.filter((value, index, items) => {
    const comparable = normalizeComparable(value);
    return !items.some((other, otherIndex) => otherIndex !== index
      && normalizeComparable(other).includes(comparable)
      && normalizeComparable(other).length > comparable.length);
  });
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
    const documentText = (item.pages || []).map((page) => unique([page.text, page.raw_text]
      .map((value) => String(value || "").trim())).join("\n")).join("\n");
    const reportHeadingCount = [
      /(?:^|\n)\s*REPORT SUMMARY\s*(?:\n|$)/i,
      /(?:^|\n)\s*SURVEYOR NOTES\s*(?:\n|$)/i,
      /(?:^|\n)\s*CAUSE OF LOSS\s*(?:\n|$)/i,
      /(?:^|\n)\s*ADEQUACY OF (?:THE )?(?:SUM INSURED|INSURED VALUE)\s*(?:\n|$)/i,
      /(?:^|\n)\s*APPOINTMENT OF ASSESSORS\s*(?:\n|$)/i,
      /(?:^|\n)\s*CONCLUSION\s*(?:\n|$)/i,
    ].filter((pattern) => pattern.test(documentText)).length;
    for (const page of item.pages || []) {
      const text = unique([page.text, page.raw_text].map((value) => String(value || "").trim())).join("\n");
      if (!text) continue;
      const capture = (field, regex, transform = (value) => value) => {
        const match = text.match(regex);
        if (match?.[1]) add(field, transform(match[1], match), item, page, sourceExcerpt(match));
      };

      if (reportHeadingCount >= 2) {
        capture(
          "report_introduction",
          /(?:^|\n)\s*(?:\d+(?:\.\d+)*[.)]?\s*)?INTRODUCTION\s*(?:\n|:)\s*([\s\S]{20,2000}?)(?=\n\s*(?:\d+(?:\.\d+)*[.)]?\s*)?(?:REPORT SUMMARY|APPOINTMENT|INTEREST INSURED|SURVEYOR NOTES|CAUSE OF LOSS|RELEVANT POLICY|ADEQUACY OF (?:THE )?(?:SUM INSURED|INSURED VALUE)|APPOINTMENT OF ASSESSORS|CLAIM PRESENTED|CONCLUSION|ENCLOSURE|SUPPORTING DOCUMENTS)\s*(?:\n|:)|$)/i,
          (value) => value.trim(),
        );
      }

      capture("policy_number", /(?:Policy|Cover\s+Note|Insurance\s+Certificate)\s*(?:No\.?|Number|Reference)\s*[:#]?\s*([A-Z0-9][A-Z0-9/.-]+)/i);
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
      capture("policy_period", /Insured\s+Period\s*:\s*(.+?)(?=\n|\s+(?:Sum Insured|Max(?:imum)? Limit|Basis of Valuation|Voyage)\s*:)/i);
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
      capture("policy_transit_scope", /((?:Containeri[sz]ed shipments?\s*:\s*)?Warehouse\s+to\s+warehouse)/i);
      capture("policy_transit_scope", /Voyage\s*:\s*((?:From\s*:)?[\s\S]{10,900}?)(?=\n\s*(?:Claim relevant|Institute Cargo Clauses|Deductible|Terms of Sale)\b)/i, (value) => value.replace(/\s+/g, " ").trim());
      capture("policy_conveyance_limits", /((?:Max(?:imum)?\s+Limit|Limit)\s+per\s+shipment\s*:[^\n]+)/i);
      capture("policy_conveyance_limits", /((?:USD|USDF|EUR|GBP|AED)\s*[0-9][0-9,.]*\s+per\s+(?:container|truck|land conveyance|vessel|shipment)[^\n]*)/i);
      capture("policy_extensions", /(Including\s+(?:Loading and Unloading Operations|Shortage noticed on unstuffing intact container seal|Non-Delivery shipping\/packing unit[^\n]*|shortage\s*&\s*Loss of weight|Trans\s*shipments?[^\n]*|Extra Expense Clause[^\n]*))/i);
      capture("policy_warranties", /(Warranted\s+[^\n]+)/i);
      capture("policy_conditions", /((?:Institute Cargo Clauses|Institute English Jurisdiction Clause|Loading and Unloading Clause|Institute Replacement Clause|Sue and Labour Clause|Duty and or Increased Value Clause)[^\n]*)/i);
      capture("policy_exclusions", /(Exclud(?:ing|ed)\s+[^\n]+)/i);
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
      capture("master_bill_of_lading", /(?:Master\s+(?:Bill of Lading|B\/?L)|MBL)(?:\s*(?:No\.?|Number|#))?\s*[:#-]?\s*([A-Z0-9/-]+)/i);
      capture("house_bill_of_lading", /(?:House\s+(?:Bill of Lading|B\/?L)|HBL)(?:\s*(?:No\.?|Number|#))?\s*[:#-]?\s*([A-Z0-9/-]+)/i);
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
      capture("terms_of_sale", /Terms? of Sale\s*[:\-]?\s*([^\n]+)/i);
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
      capture("empty_return_date", /(?:empty container|container)[^\n.]{0,80}?returned(?: empty)?[^\n.]{0,30}?(?:on\s+)?([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+[0-9]{4}|[0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i);
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
      if (/\binvoice\b/i.test(text)) {
        const wordsMatch = text.match(/\b((?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and|[0-9]{1,2}\s*\/\s*100)[\s-]+){2,})(?:euros?|dollars?|pounds?|dirhams?)\b/i);
        const wordsAmount = parseEnglishAmountWords(wordsMatch?.[1]);
        if (wordsMatch && wordsAmount !== null) add("invoice_total", wordsAmount.toFixed(2), item, page, sourceExcerpt(wordsMatch), 0.99);
      }
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
        else if (!nonClaimValuationPattern.test(label)) {
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
  "applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "claim_reference", "policy_number", "policy_period", "policy_inception_date", "policy_issue_date", "policy_terms", "policy_transit_scope", "policy_conveyance_limits", "policy_extensions", "policy_warranties", "policy_conditions", "policy_exclusions", "policy_limit", "policy_premium", "insured_value", "valuation_basis", "valuation_uplift_percent", "valuation_uplift_amount",
  "deductible", "date_of_loss", "date_of_intimation", "cause_of_loss", "country", "currency", "claim_amount",
  "gross_claim_amount", "invoice_total", "freight_amount", "insurance_amount", "fob_value", "freight_invoice_total", "fees_amount", "salvage_amount", "recovery_amount", "depreciation_amount",
  "adjusted_amount", "surveyor", "vessel_name", "voyage_number", "transshipment_port", "feeder_vessel", "feeder_voyage", "container_number", "container_numbers", "port_of_loading",
  "port_of_discharge", "commodity", "shipper", "consignee", "carrier", "air_waybill", "bill_of_lading",
  "master_bill_of_lading", "house_bill_of_lading",
  "invoice_number", "freight_invoice_number", "invoice_date", "packing_list_number", "packing_list_date", "purchase_order", "voyage_from", "voyage_to", "quantity", "net_weight", "gross_weight",
  "conveyance_mode", "country_of_origin", "destination_country", "incoterm", "terms_of_sale", "shipment_routing", "departure_date", "arrival_date", "shipment_date", "seal_numbers", "seal_condition", "production_dates", "expiry_dates",
  "freight_invoice_date", "delivery_date", "empty_return_date", "discharge_date", "damage_report_date", "notice_date", "destruction_date",
  "affected_container", "affected_quantity", "shortage_breakdown", "survey_attendance_scope", "representative_parties", "report_introduction", "salvage_quantity", "total_loss_quantity",
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
  let match = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = text.match(/\b(\d{1,2})[/-]([A-Za-z]{3,9}|\d{1,2})[/-](\d{2,4})\b/);
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

const uniqueSources = (sources = []) => {
  const seen = new Set();
  return sources.filter((source) => {
    if (!source) return false;
    const key = [source.document_id, source.document_name, source.page, source.supporting_text]
      .map((value) => String(value ?? "").trim())
      .join(":");
    if (!key.replaceAll(":", "") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function buildChronology(facts) {
  return DATE_FIELDS.flatMap(([field, label], sequence) => {
    const fact = facts[field];
    if (!fact || fact.status === "conflict" || !isPresent(fact.value)) return [];
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

  const affected = parseAtomicQuantity(facts.affected_quantity.value);
  const salvageQuantity = parseAtomicQuantity(facts.salvage_quantity.value);
  const totalLossQuantity = parseAtomicQuantity(facts.total_loss_quantity.value);
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

  const shipmentQuantity = parseAtomicQuantity(facts.quantity.value);
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
  const hasDomainLabels = findingRecords.some((finding) => finding.analysis_domain && finding.analysis_domain !== "general");
  const causeDomains = new Set(["chronology_custody", "condition_extent", "proximate_cause", "general"]);
  const causeFindingRecords = hasDomainLabels
    ? findingRecords.filter((finding) => causeDomains.has(finding.analysis_domain))
    : findingRecords;
  const reasonedOpinionFindings = causeFindingRecords.filter((finding) => /in our opinion|on balance|more consistent|comparatively more plausible|(?:appear(?:s)?\s+)?consistent with|likely attributable|most probable|available circumstances suggest|we consider|cannot be excluded|plausible (?:cause|mechanism|explanation)/i.test(finding.finding));
  const observed = causeFindingRecords.filter((finding) => /damage|deteriorat|unfit|broken|wet|water|defrost|temperature|shortage|missing|odor|mould|rust|dent|crush/i.test(finding.finding));
  const indicators = causeFindingRecords.filter((finding) => /temperature|logger|defrost|water ingress|impact|packing|seal|container|handling|delay|weather|leak/i.test(finding.finding));
  const supportedCause = facts.cause_of_loss.status === "supported" && isPresent(facts.cause_of_loss.value)
    ? facts.cause_of_loss
    : null;
  const supportedCauseText = String(supportedCause?.value || "");
  const supportedCauseSourceText = (supportedCause?.sources || [])
    .map((source) => source.supporting_text || "")
    .join(" ");
  const causeIsQualifiedOpinion = /\b(?:we are led to believe|in our opinion|on balance|likely|probably|appears?|suggests?|may|might|could|consistent with|estimated)\b/i
    .test(`${supportedCauseText} ${supportedCauseSourceText}`);
  const explicitCause = supportedCause
    && !causeIsQualifiedOpinion
    && supportedCauseText.length <= 240
    && (supportedCauseText.match(/;/g) || []).length <= 1
    && !/\b(?:packing described|damage discovered|became visible|no impact damage|survey scope|not independently|however|but)\b/i.test(supportedCauseText)
    ? supportedCause
    : null;
  const combinedFindings = causeFindingRecords.map((finding) => finding.finding).join(" ");
  const shortageClaim = /shortage|missing|non[- ]delivery/i.test(combinedFindings);
  const physicalDamageClaim = causeFindingRecords.some((finding) => {
    const text = String(finding.finding || "");
    if (/broken|breakage|fractur|crack|dent|crush|wet|deteriorat/i.test(text)) return true;
    return /\bdamag(?:e|ed)\b/i.test(text)
      && !/\bno\b[^.!?]{0,80}\bdamage\b|\bdamage report\b[^.!?]{0,50}\b(?:not|no)\b/i.test(text);
  });
  const primaryShortageClaim = shortageClaim && !physicalDamageClaim;
  const intactSeal = /seal(?:s)? (?:was|were|remained|reported|confirmed)?\s*intact|seal intact/i.test(`${facts.seal_condition?.value || ""} ${combinedFindings}`);
  const noTampering = /no (?:evidence|signs?) of (?:seal )?tampering|no forced entry|without (?:any )?(?:recorded )?seal discrepanc/i.test(combinedFindings);
  const multipleContainers = String(facts.container_numbers?.value || "").split(/\s*,\s*/).filter(Boolean).length > 1
    || /(?:all|across|distributed across) (?:the )?(?:three|multiple|several) containers/i.test(combinedFindings);
  const limitedAttendance = /only (?:possible|attended|witnessed)|prior to (?:our|the surveyor'?s) attendance|consignee'?s (?:count|reported count)|not independently (?:counted|verified)/i.test(combinedFindings);
  const missingCarrierEvidence = /no (?:carrier[- ]signed )?(?:certificate|shortage certificate)|carrier (?:abstained|did not attend)|certificate of shortage.*not (?:available|provided)/i.test(combinedFindings);
  const originConditionEvidence = /pre[- ]loading|prior to loading|container condition|no visible corrosion, damage or repairs/i.test(combinedFindings);
  const inferenceFindings = causeFindingRecords.filter((finding) => /shortage|missing|seal|tamper|forced entry|pre[- ]loading|prior to loading|packing|count|carrier|container condition/i.test(finding.finding));
  const inferenceSources = unique([
    ...(facts.seal_condition?.sources || []),
    ...(facts.container_numbers?.sources || []),
    ...inferenceFindings.flatMap((finding) => finding.sources || []),
  ]);
  const reasonedShortageInference = primaryShortageClaim && intactSeal && (multipleContainers || noTampering)
    ? `The reported shortage is distributed across ${multipleContainers ? "multiple containers" : "the shipment"}, while the available evidence records intact seals${noTampering ? " and no identified tampering or forced entry" : ""}. This weakens, but does not by itself eliminate, a sea-transit shortage scenario and makes a pre-shipment quantity discrepancy, packing/containerisation error, or unexplained disappearance before or outside the evidenced sealed transit comparatively more plausible.${originConditionEvidence ? " The pre-loading records support container condition, but do not independently prove the quantity loaded." : ""}${limitedAttendance ? " The conclusion is limited because not every container count was witnessed by the attending surveyor." : ""}${missingCarrierEvidence ? " No carrier-recognised shortage certificate or equivalent independent carrier record was established." : ""}`
    : null;
  const hypotheses = [];
  if (explicitCause) {
    hypotheses.push({
      hypothesis: String(explicitCause.value),
      status: "evidence_stated",
      assessment: "The cause is expressly stated in the claim evidence, but its physical mechanism and proximate-cause significance still require professional verification.",
      supporting_sources: uniqueSources(explicitCause.sources),
      contrary_sources: [],
      missing_evidence: ["Independent evidence confirming the stated causal mechanism and excluding material alternatives"],
    });
  } else if (supportedCause && causeIsQualifiedOpinion) {
    hypotheses.push({
      hypothesis: String(supportedCause.value),
      status: "reasoned_professional_opinion",
      assessment: "The source presents this as a qualified opinion rather than an established fact. It is retained with that qualification and remains subject to testing against the complete technical record and material alternatives.",
      supporting_sources: uniqueSources(supportedCause.sources),
      contrary_sources: [],
      missing_evidence: ["Independent technical evidence capable of confirming the proposed causal mechanism and excluding material alternatives"],
    });
  }
  for (const opinion of reasonedOpinionFindings) {
    hypotheses.push({
      hypothesis: opinion.finding,
      status: "reasoned_professional_opinion",
      assessment: "This is a qualified evidence-based opinion retained for professional review, not an extracted fact or automatic coverage determination.",
      supporting_sources: uniqueSources(opinion.sources),
      contrary_sources: [],
      missing_evidence: [],
    });
  }
  if (primaryShortageClaim) {
    const shortageSources = uniqueSources(causeFindingRecords
      .filter((finding) => /shortage|missing|non[- ]delivery/i.test(finding.finding))
      .flatMap((finding) => finding.sources || []));
    const sealSources = uniqueSources([
      ...(facts.seal_condition?.sources || []),
      ...causeFindingRecords.filter((finding) => /seal|tamper|forced entry/i.test(finding.finding)).flatMap((finding) => finding.sources || []),
    ]);
    hypotheses.push({
      hypothesis: "Loss or removal during the evidenced sealed transit",
      status: intactSeal || noTampering ? "weakened_by_available_evidence" : "open",
      assessment: intactSeal || noTampering
        ? "The recorded shortage supports investigation of transit loss, but intact seals and the absence of identified tampering weaken that mechanism unless the loading quantity and seal history are independently established."
        : "A transit-loss mechanism remains open, but the available evidence does not yet establish when or how the goods became missing.",
      supporting_sources: shortageSources,
      contrary_sources: sealSources,
      missing_evidence: ["Complete loading tally and seal history", "Independent discharge / delivery tally", "Carrier-recognised shortage or exception record"],
    });
    hypotheses.push({
      hypothesis: "Pre-shipment quantity, packing, containerisation, or counting discrepancy",
      status: intactSeal && (multipleContainers || noTampering) ? "comparatively_more_plausible" : "open",
      assessment: intactSeal && (multipleContainers || noTampering)
        ? "The intact-seal evidence makes a pre-shipment or counting discrepancy comparatively more plausible, but container condition alone does not prove the quantity actually loaded."
        : "The hypothesis cannot be resolved without independent loading and tally evidence.",
      supporting_sources: uniqueSources([...sealSources, ...shortageSources]),
      contrary_sources: [],
      missing_evidence: ["Independent origin tally or loading supervision record", "Packing and stuffing records matched to each container"],
    });
    if (limitedAttendance) {
      hypotheses.push({
        hypothesis: "Measurement or post-delivery counting discrepancy",
        status: "open",
        assessment: "Part of the reported shortage was not independently witnessed, so a counting or post-delivery handling discrepancy remains open.",
        supporting_sources: uniqueSources(causeFindingRecords.filter((finding) => /only .*count|not independently|consignee'?s count|attendance/i.test(finding.finding)).flatMap((finding) => finding.sources || [])),
        contrary_sources: [],
        missing_evidence: ["Contemporaneous witnessed count for every affected unit or container"],
      });
    }
  }
  const coldChainClaim = /temperature|defrost|cold[- ]chain|frozen|chilled/i.test(`${facts.temperature_findings?.value || ""} ${facts.damage_findings?.value || ""} ${combinedFindings}`);
  if (coldChainClaim && !explicitCause) {
    const temperatureSources = uniqueSources([
      ...(facts.temperature_findings?.sources || []),
      ...causeFindingRecords.filter((finding) => /temperature|logger|defrost|cold[- ]chain/i.test(finding.finding)).flatMap((finding) => finding.sources || []),
    ]);
    const hasMeasuredExcursion = /logger|reading|recorded|degrees?|°|excursion/i.test(`${facts.temperature_findings?.value || ""} ${combinedFindings}`)
      && !/no (?:temperature )?(?:data )?logger|not (?:available|provided)|without .*record/i.test(`${facts.temperature_findings?.value || ""} ${combinedFindings}`);
    hypotheses.push({
      hypothesis: "Cold-chain interruption or temperature excursion",
      status: hasMeasuredExcursion ? "supported_by_available_evidence" : "open",
      assessment: hasMeasuredExcursion
        ? "Measured temperature evidence and the recorded condition support a cold-chain hypothesis, subject to timing, instrument integrity, and alternative-cause review."
        : "The cargo condition is compatible with a temperature issue, but no complete temperature history establishes the timing, duration, or magnitude of an excursion.",
      supporting_sources: temperatureSources,
      contrary_sources: [],
      missing_evidence: hasMeasuredExcursion ? ["Complete logger chronology and calibration / custody information"] : ["Complete temperature logger data", "Reefer set-point and alarm history", "Pre-shipment condition evidence"],
    });
    hypotheses.push({
      hypothesis: "Pre-existing condition, inherent deterioration, or non-temperature handling factor",
      status: "not_excluded",
      assessment: "An alternative non-temperature mechanism remains open until origin condition, handling, packaging, and timing evidence are reconciled.",
      supporting_sources: [],
      contrary_sources: temperatureSources,
      missing_evidence: ["Pre-shipment quality records", "Handling and packaging evidence", "Survey opinion addressing alternative deterioration mechanisms"],
    });
  }
  if (!hypotheses.length && observed.length) {
    hypotheses.push({
      hypothesis: "Physical loss mechanism not yet established",
      status: "not_established",
      assessment: "The evidence establishes a reported condition or extent of loss, but does not yet support a reliable causal mechanism.",
      supporting_sources: uniqueSources(observed.flatMap((finding) => finding.sources || [])),
      contrary_sources: [],
      missing_evidence: ["Cause-specific investigation evidence capable of testing competing explanations"],
    });
  }
  return {
    status: explicitCause ? "evidence_stated" : observed.length ? "requires_professional_determination" : "insufficient_evidence",
    assessment_level: explicitCause
      ? "evidence_stated_not_independently_determined"
      : reasonedShortageInference ? "provisional_comparative_assessment"
        : reasonedOpinionFindings.length || causeIsQualifiedOpinion ? "provisional_evidence_based_opinion" : "not_established",
    explicit_cause: explicitCause,
    observations: observed,
    indicators,
    hypotheses,
    reasoned_inference: reasonedShortageInference,
    inference_sources: inferenceSources,
    review_questions: unique([
      "What physical mechanism most probably produced the established loss condition?",
      hypotheses.length > 1 ? "Which competing explanations are excluded by contemporaneous evidence, and which remain open?" : null,
      "Does the established mechanism satisfy the operative policy causation test and wording?",
    ]),
    evidence_gap: explicitCause
      ? null
      : reasonedShortageInference
        || (reasonedOpinionFindings.length || causeIsQualifiedOpinion
          ? "A qualified professional opinion is available from the cited evidence; final proximate-cause and coverage conclusions remain subject to review of its stated limitations and alternatives."
          : "The evidence records condition and possible causal indicators but does not establish a definitive proximate cause."),
  };
}

function buildPolicyAnalysis(facts, chronology, validationChecks, findings = []) {
  const wordingFacts = [
    facts.policy_terms,
    facts.policy_transit_scope,
    facts.policy_conveyance_limits,
    facts.policy_extensions,
    facts.policy_warranties,
    facts.policy_conditions,
    facts.policy_exclusions,
    facts.warranties_conditions,
  ].filter((fact) => isPresent(fact?.value));
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
    ["Conveyance / shipment limits", /per (?:shipment|container|vessel|truck|land conveyance)|maximum limit|max limit/i],
    ["Loading / unloading extension", /including loading and unloading|loading and unloading clause/i],
    ["Non-delivery extension", /including non-delivery|non-delivery shipping\/packing unit/i],
    ["Replacement clause", /institute replacement clause|replacement clause/i],
    ["Clean transport-document warranty", /warranted shipped under a clean original (?:bill of lading|air)/i],
    ["Theft / police-report warranty", /theft claim.*police report|police report.*theft claim/i],
    ["Container seal warranty", /warranted.*(?:printed|bullet) seals?|seals?.*during the whole voyage/i],
    ["Broken-seal joint-inspection condition", /broken or tampered seals?.*joint inspection|joint inspection.*seals?/i],
    ["Open / unattended conveyance exclusion", /excluding theft and wet perils from open \/?unattended (?:trucks?|conveyances?)/i],
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
    const wordingSources = uniqueSources(wordingFacts.flatMap((fact) => fact.sources || []));
    const factSources = uniqueSources([...supportingFacts.flatMap((fact) => fact?.sources || []), ...matchingFindings.flatMap((finding) => finding.sources || [])]);
    return [{
      topic,
      status: hasComplianceEvidence ? "evidence_available_for_review" : "compliance_requires_review",
      assessment: hasComplianceEvidence
        ? "The policy wording and related factual evidence are both present; compliance and legal effect remain for professional determination."
        : "The condition is present in the policy wording, but the normalized evidence does not independently establish compliance or breach.",
      review_question: `Do the established claim facts satisfy, breach, or fall outside the ${topic.toLowerCase()} wording?`,
      material_gap: hasComplianceEvidence ? null : `Independent claim evidence relevant to ${topic.toLowerCase()}`,
      wording_sources: wordingSources,
      fact_sources: factSources,
      sources: uniqueSources([...wordingSources, ...factSources]),
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
    status: !wordingFacts.length ? "wording_not_established" : entries.length ? "requires_professional_determination" : "wording_requires_issue_mapping",
    review_questions: entries.map((entry) => entry.review_question).filter(Boolean),
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

const evidenceGapImpact = (documentType) => {
  if (/policy/i.test(documentType)) return "Coverage, exclusions, warranties, valuation, deductible, and settlement authority cannot be concluded from claim evidence without the operative wording.";
  if (/temperature/i.test(documentType)) return "The timing, duration, and magnitude of any cold-chain excursion cannot be tested reliably.";
  if (/survey|photograph|incident/i.test(documentType)) return "The physical condition, extent, mechanism, or contemporaneous circumstances of loss remain incompletely established.";
  if (/invoice|quotation|ledger/i.test(documentType)) return "The presented quantum, unit values, or adjustment basis cannot be fully reconciled.";
  if (/bill of lading|air waybill|truck waybill|registration/i.test(documentType)) return "Transit identity, contractual carriage, timing, and potential recovery issues remain incompletely evidenced.";
  if (/packing list|claim form|notice of claim/i.test(documentType)) return "The quantity, circumstances, amount presented, or preservation of recovery rights cannot be fully verified.";
  return "A template-required part of the factual or evidential record remains unavailable for professional review.";
};

function buildEvidenceGaps(outstandingDocuments, financials, causeAssessment, policyAnalysis, conflicts) {
  const gaps = outstandingDocuments.map((documentType) => ({
    gap: documentType,
    category: "missing_document",
    priority: /policy|temperature|survey|invoice|bill of lading|air waybill|incident/i.test(documentType) ? "material" : "standard",
    impact: evidenceGapImpact(documentType),
  }));
  for (const item of financials.requires_confirmation || []) {
    gaps.push({
      gap: item,
      category: "quantum_input",
      priority: "material",
      impact: "The adjustment remains provisional or cannot be concluded without assuming an unsupported value.",
    });
  }
  if (!causeAssessment.explicit_cause && !causeAssessment.reasoned_inference) {
    gaps.push({
      gap: "Reliable causal mechanism",
      category: "causation",
      priority: "material",
      impact: "Proximate cause and its relationship to the policy wording cannot be determined reliably.",
    });
  }
  if (!policyAnalysis.has_wording) {
    gaps.push({
      gap: "Operative policy wording",
      category: "coverage",
      priority: "material",
      impact: "No coverage, exclusion, warranty, or valuation conclusion can be made from claim evidence.",
    });
  }
  for (const conflict of conflicts) {
    gaps.push({
      gap: `Resolve conflict: ${String(conflict.field || "claim evidence").replaceAll("_", " ")}`,
      category: "conflict",
      priority: "material",
      impact: conflict.message,
    });
  }
  return gaps.filter((gap, index, items) => items.findIndex((candidate) =>
    normalizeComparable(candidate.gap) === normalizeComparable(gap.gap)
      && candidate.category === gap.category) === index);
}

function buildLiabilityAnalysis(facts, businessLine, findings, financials) {
  const findingsText = findings.map((finding) => finding.finding || "").join(" ");
  const transportClaim = /marine|cargo|shipment|bulk vessel|yacht/i.test(businessLine);
  const carrierFacts = [facts.carrier, facts.bill_of_lading, facts.air_waybill, facts.truck_waybill].filter((fact) => isPresent(fact?.value));
  const noticeFacts = [facts.notice_date, facts.date_of_intimation].filter((fact) => isPresent(fact?.value));
  const recoveryFacts = [facts.recovery_findings, facts.recovery_amount].filter((fact) => isPresent(fact?.value));
  const issues = [];
  if (transportClaim || carrierFacts.length || /carrier|shipowner|airline|third party/i.test(findingsText)) {
    const carrierEvidence = findings.filter((finding) => /carrier|shipowner|airline|delivery|shortage certificate|exception/i.test(finding.finding || ""));
    issues.push({
      issue: "Potential carrier or contractual recovery",
      status: carrierFacts.length ? "evidence_available_for_review" : "counterparty_or_contract_not_established",
      assessment: carrierFacts.length
        ? "A carrier and/or transport contract is identified. Liability, defences, time bars, notice compliance, and recoverability require separate professional determination from the carriage documents and facts."
        : "The available record does not establish the counterparty and transport contract needed for a reliable recovery assessment.",
      evidence_for_review: uniqueSources([...carrierFacts.flatMap((fact) => fact.sources || []), ...carrierEvidence.flatMap((finding) => finding.sources || [])]),
      evidence_against: [],
      review_question: "What contractual or legal recovery route is available, against whom, and have notice and time-bar protections been preserved?",
      material_gaps: [
        carrierFacts.length ? null : "Carrier identity and operative carriage contract",
        noticeFacts.length ? null : "Evidence of timely notice / claim preservation",
        /carrier.*(?:admit|accept)|admission of liability/i.test(findingsText) ? null : "Carrier response, exception record, or liability position",
      ].filter(Boolean),
    });
  }
  const salvageOrRecoveryRelevant = financials.presented_claim !== null
    || financials.salvage !== null
    || financials.recovery !== null
    || /salvage|recovery|mitigat/i.test(findingsText);
  if (salvageOrRecoveryRelevant) {
    issues.push({
      issue: "Mitigation, salvage, and recovery credit",
      status: recoveryFacts.length || financials.salvage !== null || financials.recovery !== null ? "evidence_available_for_review" : "requires_confirmation",
      assessment: "Mitigation steps, salvage value, and recoveries must be evidenced separately; an unknown amount is not treated as zero in the adjustment.",
      evidence_for_review: uniqueSources(recoveryFacts.flatMap((fact) => fact.sources || [])),
      evidence_against: [],
      review_question: "Were reasonable mitigation steps taken, and are all salvage proceeds or recoveries quantified and credited once only?",
      material_gaps: [
        financials.salvage === null ? "Salvage value or explicit confirmation that none applies" : null,
        financials.recovery === null ? "Recovery amount or explicit confirmation that none applies" : null,
      ].filter(Boolean),
    });
  }
  return {
    status: issues.length ? "requires_professional_determination" : "no_specific_liability_route_established",
    issues,
    conclusion: "No liability or recovery conclusion is made automatically; the issues above identify the evidence and decisions required from the professional reviewer.",
  };
}

function buildQuantumAnalysis(financials, adjustment, validationChecks) {
  const failedChecks = validationChecks.filter((check) => check.status === "requires_review");
  const status = financials.concluded_indemnity !== null && financials.arithmetic_valid && !failedChecks.length
    ? "arithmetically_validated_requires_coverage_review"
    : financials.provisional_indemnity !== null ? "provisional" : financials.concluded_indemnity !== null ? "requires_reconciliation" : "not_concluded";
  const assessment = status === "arithmetically_validated_requires_coverage_review"
    ? "The supported adjustment inputs reconcile arithmetically. Coverage, liability, settlement authority, and professional approval remain separate decisions."
    : status === "provisional"
      ? "The available inputs produce a provisional amount, but one or more deductions, credits, coverage matters, or source figures remain unconfirmed."
      : status === "requires_reconciliation"
        ? "A concluded amount is stated in the evidence, but the supported components do not reproduce it reliably."
        : "A concluded indemnity cannot be calculated without unsupported assumptions.";
  return {
    status,
    assessment,
    calculation_steps: adjustment.steps,
    validation_checks: validationChecks.filter((check) => /invoice|valuation|quantity|claim-schedule|adjusted/i.test(check.id)),
    unresolved_inputs: financials.requires_confirmation || [],
    human_review_required: true,
  };
}

function buildReportQualityReview({ facts, financials, findings, causeAssessment, policyAnalysis, quantumAnalysis, liabilityAnalysis, conflicts, evidenceGaps }) {
  const unsupportedFindings = findings.filter((finding) => !(finding.sources || []).length);
  const truncatedFindings = findings.filter((finding) => /(?:\bp{1,2}\.|\b(?:and|or|but|because|including|namely|at|from|to|on|of|with)|[:;(,-])\s*$/i.test(String(finding.finding || "").trim()));
  const invalidCurrency = financials.adjusted_claim_amount !== null && !/^[A-Z]{3}$/.test(String(financials.currency || ""));
  const negativeFinancials = ["adjusted_claim_amount", "provisional_indemnity", "concluded_indemnity"]
    .filter((field) => financials[field] !== null && Number(financials[field]) < 0);
  const warrantyUnderExclusions = /^warrant(?:ed|y|ies)\b/i.test(String(facts.policy_exclusions?.value || "").trim());
  const checks = [
    {
      id: "evidence-trace",
      label: "Material findings linked to claim evidence",
      status: unsupportedFindings.length ? "requires_review" : "passed",
      detail: unsupportedFindings.length
        ? `${unsupportedFindings.length} material finding(s) have no retained claim-evidence citation.`
        : "Every retained material finding has at least one claim-evidence source.",
    },
    {
      id: "causation",
      label: "Competing causal explanations tested",
      status: causeAssessment.hypotheses.length && causeAssessment.assessment_level !== "not_established" ? "passed_with_professional_review" : "requires_review",
      detail: causeAssessment.hypotheses.length
        ? `${causeAssessment.hypotheses.length} causal hypothesis or hypotheses are recorded with limitations and evidence needs.`
        : "No testable causal hypothesis could be built from the available evidence.",
    },
    {
      id: "coverage",
      label: "Policy wording mapped to claim facts",
      status: policyAnalysis.has_wording && policyAnalysis.entries.length ? "passed_with_professional_review" : "requires_review",
      detail: policyAnalysis.has_wording
        ? `${policyAnalysis.entries.length} policy issue(s) are mapped for professional determination.`
        : "Operative policy wording was not established from the claim evidence.",
    },
    {
      id: "quantum",
      label: "Quantum reconciled without unsupported assumptions",
      status: quantumAnalysis.status === "arithmetically_validated_requires_coverage_review" ? "passed_with_professional_review" : "requires_review",
      detail: quantumAnalysis.assessment,
    },
    {
      id: "liability-recovery",
      label: "Liability and recovery issues identified",
      status: liabilityAnalysis.issues.length ? "passed_with_professional_review" : "not_applicable_or_not_established",
      detail: liabilityAnalysis.issues.length
        ? `${liabilityAnalysis.issues.length} liability, mitigation, or recovery issue(s) require professional determination.`
        : "No specific liability or recovery route was established from the available evidence.",
    },
    {
      id: "conflicts",
      label: "Material contradictions resolved",
      status: conflicts.length ? "requires_review" : "passed",
      detail: conflicts.length ? `${conflicts.length} material conflict(s) remain visible for resolution.` : "No unresolved deterministic conflict was detected.",
    },
    {
      id: "client-narrative-completeness",
      label: "Client narrative contains complete sentences",
      status: truncatedFindings.length ? "requires_review" : "passed",
      detail: truncatedFindings.length ? `${truncatedFindings.length} finding(s) end in a dangling or incomplete fragment and are withheld or require rewriting.` : "No retained finding ends in a recognized dangling fragment.",
    },
    {
      id: "financial-presentation-safety",
      label: "Currency and indemnity presentation are safe",
      status: invalidCurrency || negativeFinancials.length ? "requires_review" : "passed",
      detail: invalidCurrency
        ? "An adjusted amount exists without one supported ISO reporting currency."
        : negativeFinancials.length ? `Negative reportable amount(s) detected: ${negativeFinancials.join(", ")}.` : "No negative indemnity is reportable and any adjusted amount uses one ISO currency.",
    },
    {
      id: "policy-category-integrity",
      label: "Warranties, conditions, and exclusions remain separate",
      status: warrantyUnderExclusions ? "requires_review" : "passed",
      detail: warrantyUnderExclusions ? "Warranty wording was placed under exclusions and must be reclassified before issue." : "No recognized warranty wording is presented as an exclusion.",
    },
  ];
  const materialGaps = evidenceGaps.filter((gap) => gap.priority === "material");
  const reviewActions = unique([
    ...causeAssessment.review_questions,
    ...policyAnalysis.review_questions,
    ...liabilityAnalysis.issues.map((issue) => issue.review_question),
    ...quantumAnalysis.unresolved_inputs.map((item) => `Confirm ${item.toLowerCase()} from claim evidence or an authorized professional decision.`),
    ...conflicts.map((conflict) => conflict.message),
  ]).filter(Boolean);
  return {
    draft_readiness: materialGaps.length || checks.some((check) => check.status === "requires_review")
      ? "material_review_items_present"
      : "ready_for_professional_review",
    professional_review_required: true,
    approval_required_before_issue: true,
    checks,
    material_gap_count: materialGaps.length,
    review_actions: reviewActions,
    issue_blockers: [
      invalidCurrency ? "Resolve the reporting currency before issuing an adjusted amount." : null,
      negativeFinancials.length ? "Reconcile negative reportable financial amounts before issue." : null,
      truncatedFindings.length ? "Rewrite or remove dangling narrative fragments before issue." : null,
      warrantyUnderExclusions ? "Reclassify warranty wording that is currently presented as an exclusion." : null,
    ].filter(Boolean),
  };
}

function buildSelectedPhotographs(appendices, findings) {
  const appendixIds = new Set(appendices.map((document) => document.document_id));
  const materialPattern = /damage|broken|crack|deteriorat|wet|shortage|missing|packing|carton|foam|pallet|container|seal|tamper|impact|compression|movement|stow/i;
  const candidates = [];
  for (const finding of findings) {
    const captionText = sanitizeReportValue(finding.finding);
    if (!captionText || !materialPattern.test(captionText)) continue;
    for (const source of finding.sources || []) {
      if (!appendixIds.has(source.document_id)) continue;
      const visual = ["image_vision", "document_vision"].includes(source.evidence_mode);
      candidates.push({
        document_id: source.document_id,
        document_name: source.document_name,
        page: source.page ?? null,
        caption: `Representative visual evidence: ${captionText.replace(/[.!?]+$/, "")}.`,
        score: (visual ? 20 : 0) + (materialPattern.test(captionText) ? 10 : 0) + Number(finding.confidence || 0),
      });
    }
  }
  const uniqueCandidates = candidates
    .sort((left, right) => right.score - left.score)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.document_id === item.document_id && candidate.page === item.page) === index)
    .slice(0, 6);
  if (uniqueCandidates.length) return uniqueCandidates.map((item) => ({
    document_id: item.document_id,
    document_name: item.document_name,
    page: item.page,
    caption: item.caption,
  }));
  return appendices.slice(0, 3).map((document) => ({
    document_id: document.document_id,
    document_name: document.document_name,
    page: null,
    caption: "Overview of the claim-related visual condition available for professional review.",
  }));
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
  ].map(normalizedCandidate);
  const conflicts = [];
  const facts = {};
  const fieldTrace = {};

  for (const field of claimFieldNames) {
    const rawClaimValue = claim[field === "container_numbers" ? "container_number" : field];
    const sanitizedClaimValue = sanitizeSuggestedClaimValue(field, rawClaimValue);
    const candidates = allCandidates.filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .filter((candidate) => isPresent(candidate.normalized_value ?? candidate.value));
    const hasEvidenceConfirmedZero = candidates.some((candidate) => {
      const number = parseNumber(candidate.normalized_value ?? candidate.value);
      return number === 0 && (candidate.sources || []).length > 0;
    });
    const zeroPlaceholder = monetaryClaimFields.has(field) && parseNumber(sanitizedClaimValue) === 0 && !hasEvidenceConfirmedZero;
    const claimValue = isPresent(sanitizedClaimValue) && !zeroPlaceholder ? sanitizedClaimValue : null;
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
    const metadataFallbackAllowed = !entityFields.has(field);
    let selected = selectedCandidate
      ? selectedCandidate.normalized_value ?? selectedCandidate.value
      : metadataFallbackAllowed ? claimValue : null;
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
      metadata_rejected_as_contaminated: isPresent(rawClaimValue) && !isPresent(sanitizedClaimValue),
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
        : isPresent(claimValue) && metadataFallbackAllowed
          ? "claim metadata fallback; no evidence candidate was available"
          : isPresent(claimValue)
            ? "claim metadata retained as context only; no evidence candidate established the report fact"
            : "not established after reviewing all evidence candidates",
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
    const fieldCandidates = allCandidates
      .filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .filter((candidate) => isPresent(candidate.normalized_value ?? candidate.value));
    const rawValues = unique(fieldCandidates
      .flatMap((candidate) => String((candidate.normalized_value ?? candidate.value) || "").split(/\s*,\s*/)));
    const containerTokens = field === "container_numbers" ? unique(rawValues.flatMap(extractContainerNumbers)) : [];
    const validContainerTokens = containerTokens.filter(validContainerNumber);
    const values = field === "container_numbers"
      ? validContainerTokens.length ? validContainerTokens : containerTokens
      : rawValues;
    if (values.length) {
      facts[field] = { ...facts[field], value: values.join(", "), status: "supported", sources: fieldCandidates.flatMap((candidate) => candidate.sources || []), candidate_values: values };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: facts[field].value, resolution: "merged all evidence-supported identifiers", final_status: "supported" };
      const conflictIndex = conflicts.findIndex((conflict) => conflict.field === field);
      if (conflictIndex >= 0) conflicts.splice(conflictIndex, 1);
    }
  }
  for (const field of [
    "policy_terms", "policy_transit_scope", "policy_conveyance_limits", "policy_extensions", "policy_warranties",
    "policy_conditions", "policy_exclusions", "warranties_conditions", "shipment_routing", "representative_parties",
    "damage_findings", "temperature_findings",
  ]) {
    const candidates = allCandidates.filter((candidate) => candidate.field === field && !candidate.requires_confirmation)
      .filter((candidate) => isPresent(candidate.normalized_value ?? candidate.value));
    const candidateValues = unique(candidates.map((candidate) => String(candidate.normalized_value ?? candidate.value).replace(/\s+/g, " ").trim()));
    const values = POLICY_TEXT_FIELDS.has(field) ? completePolicyValues(candidateValues) : candidateValues;
    if (!isPresent(claim[field]) && values.length) {
      const retainedCandidates = candidates.filter((candidate) => values.includes(String(candidate.normalized_value ?? candidate.value).replace(/\s+/g, " ").trim()));
      facts[field] = {
        ...facts[field],
        value: values.join(" — "),
        status: "supported",
        sources: retainedCandidates.flatMap((candidate) => candidate.sources || []),
        candidate_values: values,
      };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: facts[field].value, resolution: "merged complementary evidence passages", final_status: "supported" };
      const conflictIndex = conflicts.findIndex((conflict) => conflict.field === field);
      if (conflictIndex >= 0) conflicts.splice(conflictIndex, 1);
    } else if (POLICY_TEXT_FIELDS.has(field) && candidateValues.length && !values.length) {
      facts[field] = {
        ...facts[field],
        value: null,
        status: "requires_confirmation",
        sources: [],
        candidate_values: candidateValues,
      };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: null, resolution: "incomplete policy fragment withheld from the issued report", final_status: "requires_confirmation" };
      if (!conflicts.some((conflict) => conflict.field === field)) conflicts.push({
        field,
        values: candidateValues,
        message: `Only an incomplete ${field.replaceAll("_", " ")} fragment was extracted; the complete operative wording must be verified before it is reproduced or applied.`,
      });
    }
  }

  for (const field of ["quantity", "affected_quantity", "salvage_quantity", "total_loss_quantity"]) {
    const value = facts[field]?.value;
    const numericParts = String(value || "").match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g) || [];
    if (!isPresent(value) || numericParts.length <= 1 || parseAtomicQuantity(value) !== null) continue;
    facts[field] = { ...facts[field], status: "conflict" };
    fieldTrace[field] = { ...fieldTrace[field], resolution: "composite or alternative quantities retained for review; not treated as one calculable number", final_status: "conflict" };
    if (!conflicts.some((conflict) => conflict.field === field)) conflicts.push({
      field,
      values: facts[field].candidate_values?.length ? facts[field].candidate_values : [String(value)],
      message: `The ${field.replaceAll("_", " ")} contains multiple quantities or units and cannot be used as one calculation input; the underlying source positions must be reconciled separately.`,
    });
  }

  const rawAdjustmentLineItems = [...(resolvedAnalysis?.adjustment_line_items || []), ...(deterministic.adjustmentLineItems || [])];
  const rejectedAdjustmentLineItems = rawAdjustmentLineItems.filter((item) => !validAdjustmentLineItem(item));
  if (rejectedAdjustmentLineItems.length) {
    conflicts.push({
      field: "adjustment_line_items",
      values: rejectedAdjustmentLineItems.map((item) => String(item.description || "Unlabelled monetary value")),
      message: "Policy, shipment, invoice-total, or other non-loss valuation figures were excluded from the claim adjustment schedule.",
    });
  }
  const initiallyNormalizedAdjustmentLineItems = rawAdjustmentLineItems.filter(validAdjustmentLineItem).flatMap((item) => {
    const calculated = deterministicAdjustmentValue(item);
    const adjustedValue = calculated.value;
    if (!isPresent(item.description) || adjustedValue === null || !(item.sources || []).length) return [];
    return [{
      description: String(item.description).trim(),
      quantity: isPresent(item.quantity) ? String(item.quantity).trim() : null,
      unit_price: parseNumber(item.unit_price),
      adjusted_value: adjustedValue,
      currency: currencyCode(item.currency) || item.currency || null,
      basis: calculated.derived
        ? `${isPresent(item.basis) ? `${String(item.basis).trim()}; ` : ""}deterministically calculated from the cited quantity/conversion and matching unit rate`
        : isPresent(item.basis) ? String(item.basis).trim() : null,
      line_kind: deductionLineKind(item) || "loss",
      evidence_basis: provisionalItem(item) ? "provisional" : quotationBasedItem(item) ? "quotation" : "claim_or_incurred_evidence",
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
  const schedulePresentedClaim = parseNumber(facts.gross_claim_amount.value) ?? parseNumber(facts.claim_amount.value);
  const scheduleAdjustedAmount = parseNumber(facts.adjusted_amount.value);
  const aggregateLinePattern = /\b(?:aggregate|claim(?:ed)?\s+(?:damage|loss)\s+value|gross\s+claim|schedule\s+(?:total|summary)|total\s+(?:claim|damage|loss))\b/i;
  const initialLossItems = initiallyNormalizedAdjustmentLineItems.filter((item) => item.line_kind === "loss");
  const detailedLossItems = initialLossItems.filter((item) => !aggregateLinePattern.test(item.description));
  const detailedLossTotal = detailedLossItems.reduce((total, item) => total + item.adjusted_value, 0);
  const approximatelyEqual = (left, right) => left !== null && right !== null && Math.abs(left - right) <= 0.01;
  const excludedAggregateLines = detailedLossItems.length >= 2
    ? initialLossItems.filter((item) => aggregateLinePattern.test(item.description) && (
      approximatelyEqual(item.adjusted_value, detailedLossTotal)
      || (approximatelyEqual(item.adjusted_value, schedulePresentedClaim) && approximatelyEqual(detailedLossTotal, scheduleAdjustedAmount))
    ))
    : [];
  if (excludedAggregateLines.length) conflicts.push({
    field: "adjustment_line_items",
    values: excludedAggregateLines.map((item) => `${item.description}: ${item.adjusted_value}`),
    message: "An aggregate claim or schedule-summary row was excluded from the detailed loss schedule to prevent the same loss from being counted twice.",
  });
  const normalizedAdjustmentLineItems = initiallyNormalizedAdjustmentLineItems.filter((item) => !excludedAggregateLines.includes(item));
  const deductionLineItems = normalizedAdjustmentLineItems.filter((item) => item.line_kind !== "loss");
  const adjustmentLineItems = normalizedAdjustmentLineItems.filter((item) => item.line_kind === "loss");
  const itemizedClaimTotal = adjustmentLineItems.length
    ? adjustmentLineItems.reduce((total, item) => total + item.adjusted_value, 0)
    : null;
  const itemCurrencies = unique(normalizedAdjustmentLineItems.map((item) => currencyCode(item.currency) || item.currency).filter(isPresent));
  if (itemCurrencies.length === 1) {
    const itemCurrency = itemCurrencies[0];
    facts.currency = { ...facts.currency, value: itemCurrency, status: "supported", sources: adjustmentLineItems.flatMap((item) => item.sources) };
    fieldTrace.currency = { ...fieldTrace.currency, selected_value: itemCurrency, resolution: "derived from the evidence-reconciled adjustment schedule", final_status: "supported" };
  }
  let explicitPresentedClaim = parseNumber(facts.gross_claim_amount.value) ?? parseNumber(facts.claim_amount.value);
  const presentedClaimFact = parseNumber(facts.gross_claim_amount.value) !== null ? facts.gross_claim_amount : facts.claim_amount;
  if (explicitPresentedClaim !== null && (factBasedOnlyOnQuotation(presentedClaimFact) || factBasedOnlyOnProvisionalEvidence(presentedClaimFact))) {
    conflicts.push({
      field: "gross_claim_amount",
      values: [String(explicitPresentedClaim)],
      message: "The only source for the stated amount is a quotation, estimate, extrapolation, miscellaneous schedule, or otherwise provisional evidence. It is retained as provisional valuation evidence and is not treated as a claim presented or an incurred cost.",
    });
    explicitPresentedClaim = null;
  }
  const rejectedValuationValues = rejectedAdjustmentLineItems.map((item) => parseNumber(item.adjusted_value)).filter((value) => value !== null);
  const rejectedValuationTotal = rejectedValuationValues.reduce((total, value) => total + value, 0);
  const presentedDifference = explicitPresentedClaim !== null && itemizedClaimTotal !== null
    ? explicitPresentedClaim - itemizedClaimTotal
    : null;
  const rejectedValuationExplainsDifference = presentedDifference !== null && (
    Math.abs(presentedDifference - rejectedValuationTotal) < 0.01
    || rejectedValuationValues.some((value) => Math.abs(presentedDifference - value) < 0.01)
  );
  if (explicitPresentedClaim !== null && itemizedClaimTotal !== null && rejectedValuationValues.length
    && rejectedValuationExplainsDifference) {
    conflicts.push({
      field: "gross_claim_amount",
      values: [String(explicitPresentedClaim), String(itemizedClaimTotal)],
      message: "The stated gross claim appears to combine the evidenced loss schedule with a non-claim insured/shipment valuation; only the loss schedule is retained for provisional adjustment.",
    });
    explicitPresentedClaim = null;
    for (const field of ["claim_amount", "gross_claim_amount"]) {
      facts[field] = { ...facts[field], value: itemizedClaimTotal.toFixed(2), status: "conflict", derived_from: "adjustment_line_items_after_non_claim_value_rejection" };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: itemizedClaimTotal.toFixed(2), resolution: "excluded a non-claim valuation from the presented quantum", final_status: "conflict" };
    }
  }
  const itemEvidenceBases = unique(adjustmentLineItems.map((item) => item.evidence_basis));
  const itemizedEvidenceBasis = itemEvidenceBases.length === 1
    ? itemEvidenceBases[0]
    : itemEvidenceBases.length ? "mixed_provisional" : null;
  const itemizedScheduleCanEvidencePresentedClaim = adjustmentLineItems.length > 0
    && adjustmentLineItems.every((item) => item.evidence_basis === "claim_or_incurred_evidence");
  const presentedClaim = explicitPresentedClaim ?? (itemizedScheduleCanEvidencePresentedClaim ? itemizedClaimTotal : null);
  if (explicitPresentedClaim === null && itemizedClaimTotal !== null && itemizedScheduleCanEvidencePresentedClaim) {
    const formattedTotal = itemizedClaimTotal.toFixed(2);
    for (const field of ["claim_amount", "gross_claim_amount"]) {
      facts[field] = { ...facts[field], value: formattedTotal, status: "supported", sources: adjustmentLineItems.flatMap((item) => item.sources), derived_from: "adjustment_line_items" };
      fieldTrace[field] = { ...fieldTrace[field], selected_value: formattedTotal, resolution: "deterministic sum of evidence-supported adjustment line items", final_status: "supported" };
    }
  }
  if (explicitPresentedClaim === null && itemizedClaimTotal !== null && !itemizedScheduleCanEvidencePresentedClaim) {
    conflicts.push({
      field: "gross_claim_amount",
      values: [String(itemizedClaimTotal)],
      message: "The itemized schedule contains quotation, estimate, extrapolated, miscellaneous, or otherwise provisional evidence. It is retained for review but is not treated automatically as the presented claim or a reconciled incurred amount.",
    });
  }
  const deductionAmount = (kind, factName) => {
    const factAmount = parseNumber(facts[factName].value);
    const matching = deductionLineItems.filter((item) => item.line_kind === kind);
    if (factAmount !== null) {
      if (matching.length) {
        const lineAmount = matching.reduce((total, item) => total + Math.abs(item.adjusted_value), 0);
        if (Math.abs(Math.abs(factAmount) - lineAmount) > 0.01) conflicts.push({
          field: factName,
          values: [String(Math.abs(factAmount)), String(lineAmount)],
          message: `The stated ${factName.replaceAll("_", " ")} does not match the corresponding adjustment deduction row and requires reconciliation.`,
        });
      }
      return Math.abs(factAmount);
    }
    if (!matching.length) return null;
    const derived = matching.reduce((total, item) => total + Math.abs(item.adjusted_value), 0);
    facts[factName] = {
      ...facts[factName],
      value: derived.toFixed(2),
      status: "supported",
      sources: matching.flatMap((item) => item.sources),
      derived_from: "adjustment_deduction_line_items",
    };
    fieldTrace[factName] = { ...fieldTrace[factName], selected_value: derived.toFixed(2), resolution: "derived from separately classified evidence-supported deduction rows", final_status: "supported" };
    return derived;
  };
  const documentedDeductible = deductionAmount("deductible", "deductible");
  const deductibleEvidenceText = (facts.deductible.sources || []).map((source) => source.supporting_text || "").join(" ");
  const deductibleTerms = parseDeductibleTerms(deductibleEvidenceText, documentedDeductible);
  const explicitDeductibleLineAmount = deductionLineItems.some((item) => item.line_kind === "deductible")
    ? deductionLineItems.filter((item) => item.line_kind === "deductible").reduce((total, item) => total + Math.abs(item.adjusted_value), 0)
    : null;
  const salvage = deductionAmount("salvage", "salvage_amount");
  const recovery = deductionAmount("recovery", "recovery_amount");
  const depreciation = deductionAmount("depreciation", "depreciation_amount");
  const explicitAdjusted = parseNumber(facts.adjusted_amount.value);
  const adjustedClaimAmount = itemizedClaimTotal ?? explicitAdjusted ?? presentedClaim;
  const underlyingAdjustedLoss = itemizedClaimTotal ?? presentedClaim;
  const valuationUpliftPercent = parseNumber(facts.valuation_uplift_percent.value);
  const explicitValuationUplift = parseNumber(facts.valuation_uplift_amount.value);
  const valuationUpliftAmount = explicitValuationUplift ?? (underlyingAdjustedLoss !== null && valuationUpliftPercent !== null
    ? Number((underlyingAdjustedLoss * valuationUpliftPercent / 100).toFixed(4))
    : null);
  const calculationBase = underlyingAdjustedLoss === null
    ? null
    : underlyingAdjustedLoss + (valuationUpliftAmount ?? 0);
  const deductible = applicableDeductible({
    terms: deductibleTerms,
    calculationBase,
    documentedAmount: documentedDeductible,
    explicitLineAmount: explicitDeductibleLineAmount,
    claimCurrency: currencyCode(facts.currency.value),
  });
  if (deductibleTerms.aggregate && explicitDeductibleLineAmount === null) conflicts.push({
    field: "applicable_deductible",
    values: documentedDeductible === null ? [] : [String(documentedDeductible)],
    message: "The policy states an aggregate deductible or excess, but the reviewed evidence does not establish the remaining aggregate, prior erosion, or a claim-specific applied deduction. The amount is shown as policy wording and is not deducted automatically.",
  });
  if (deductibleTerms.franchise && explicitDeductibleLineAmount === null) conflicts.push({
    field: "applicable_deductible",
    values: documentedDeductible === null ? [] : [String(documentedDeductible)],
    message: "The policy uses franchise wording. Its legal and arithmetic effect is not treated as an ordinary deductible without an evidenced claim-specific application.",
  });
  if (deductibleTerms.currency && currencyCode(facts.currency.value) && deductibleTerms.currency !== currencyCode(facts.currency.value)) conflicts.push({
    field: "applicable_deductible_currency",
    values: [deductibleTerms.currency, currencyCode(facts.currency.value)],
    message: "The deductible currency differs from the adjustment currency and no evidenced conversion basis is available; the deductible is not applied automatically.",
  });
  if (deductibleTerms.percentage !== null && calculationBase === null) conflicts.push({
    field: "applicable_deductible",
    values: [`${deductibleTerms.percentage}%`],
    message: "A percentage deductible is evidenced, but the supported calculation base is not established, so no claim-specific deductible is calculated.",
  });
  const valuationAdjustment = presentedClaim !== null && itemizedClaimTotal !== null ? Number((presentedClaim - itemizedClaimTotal).toFixed(2)) : null;
  const canCalculateWithoutExplicit = calculationBase !== null && [deductible, salvage, recovery, depreciation].every((value) => value !== null);
  const knownDeductions = [deductible, salvage, recovery, depreciation].filter((value) => value !== null);
  const rawKnownCalculated = calculationBase === null
    ? null
    : Number((calculationBase - knownDeductions.reduce((total, value) => total + Math.abs(value), 0)).toFixed(4));
  const knownCalculated = rawKnownCalculated === null ? null : Math.max(0, rawKnownCalculated);
  if (rawKnownCalculated !== null && rawKnownCalculated < 0) conflicts.push({
    field: "provisional_indemnity",
    values: [String(rawKnownCalculated), "0"],
    message: "Supported deductions exceed the supported adjusted loss. The provisional payable is floored at zero; a negative indemnity is never reported.",
  });
  const arithmeticValid = explicitAdjusted !== null && knownCalculated !== null ? Math.abs(explicitAdjusted - knownCalculated) <= 0.01 : false;
  const explicitAdjustedNonNegative = explicitAdjusted !== null && explicitAdjusted >= 0 ? explicitAdjusted : null;
  if (explicitAdjusted !== null && explicitAdjusted < 0) conflicts.push({
    field: "adjusted_amount",
    values: [String(explicitAdjusted)],
    message: "A negative adjusted amount cannot represent an indemnity and is withheld pending reconciliation of the calculation.",
  });
  const explicitAdjustedReconciled = explicitAdjustedNonNegative !== null && (!canCalculateWithoutExplicit || knownCalculated === null || arithmeticValid);
  const itemizedQuantityConflict = itemizedClaimTotal !== null && conflicts.some((conflict) => ["quantity", "affected_quantity", "shortage_breakdown"].includes(conflict.field));
  const provisionalItemizedSchedule = itemizedClaimTotal !== null && !itemizedScheduleCanEvidencePresentedClaim;
  const concludedIndemnity = provisionalItemizedSchedule
    ? null
    : explicitAdjusted !== null
    ? explicitAdjustedReconciled ? explicitAdjustedNonNegative : null
    : canCalculateWithoutExplicit && !itemizedQuantityConflict ? knownCalculated : null;
  const reconciledItemizedAdjustment = itemizedClaimTotal !== null && explicitAdjusted !== null && arithmeticValid;
  const financials = {
    currency: facts.currency.value || null,
    presented_claim: presentedClaim,
    itemized_claim_total: itemizedClaimTotal,
    itemized_evidence_basis: itemizedEvidenceBasis,
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
    documented_deductible: documentedDeductible,
    deductible_terms: deductibleTerms,
    deductible, salvage, recovery, depreciation,
    provisional_indemnity: knownCalculated,
    concluded_indemnity: concludedIndemnity,
    calculation_status: arithmeticValid || (canCalculateWithoutExplicit && concludedIndemnity !== null)
      ? "validated"
      : explicitAdjusted !== null
        ? "source_stated_requires_reconciliation"
        : "requires_confirmation",
    arithmetic_valid: arithmeticValid || (canCalculateWithoutExplicit && explicitAdjusted === null && !itemizedQuantityConflict),
    requires_confirmation: [
      presentedClaim === null ? "Presented claim quantum" : null,
      deductible === null ? "Applicable deductible / excess" : null,
      salvage === null && !reconciledItemizedAdjustment ? "Salvage deduction or explicit confirmation that none applies" : null,
      recovery === null && !reconciledItemizedAdjustment ? "Recovery credit or explicit confirmation that none applies" : null,
      depreciation === null && !reconciledItemizedAdjustment ? "Depreciation or explicit confirmation that none applies" : null,
      concludedIndemnity === null ? "Concluded indemnity" : null,
      provisionalItemizedSchedule ? "Verification and reconciliation of provisional itemized loss evidence" : null,
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
  const evidenceGaps = buildEvidenceGaps(outstandingDocuments, financials, causeAssessment, policyAnalysis, conflicts);
  const liabilityAnalysis = buildLiabilityAnalysis(facts, businessLine, evidenceFindings, financials);
  const quantumAnalysis = buildQuantumAnalysis(financials, adjustment, validationChecks);
  const reportQuality = buildReportQualityReview({
    facts,
    financials,
    findings: evidenceFindings,
    causeAssessment,
    policyAnalysis,
    quantumAnalysis,
    liabilityAnalysis,
    conflicts,
    evidenceGaps,
  });
  const appendices = documentRegister.filter((document) => document.categories.includes("Photographs") || document.image_only_pages > 0);
  const selectedPhotographs = buildSelectedPhotographs(appendices, evidenceFindings);
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
    liability_analysis: liabilityAnalysis,
    quantum_analysis: quantumAnalysis,
    evidence_gaps: evidenceGaps,
    report_quality: reportQuality,
    professional_reasoning: {
      cause: causeAssessment,
      coverage: policyAnalysis,
      liability: liabilityAnalysis,
      quantum: quantumAnalysis,
      quality_review: reportQuality,
    },
    adjustment,
    document_register: documentRegister,
    appendices,
    selected_photographs: selectedPhotographs,
    analysis_narrative: {
      summary: resolvedAnalysis?.summary || null,
      warnings: resolvedAnalysis?.warnings || [],
      review_items: unique([...(resolvedAnalysis?.human_review_required || []), ...reportQuality.review_actions]),
    },
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
  const safeValue = sanitizeReportValue(fact?.value, field);
  if (!fact || !isPresent(safeValue)) return REQUIRES_CONFIRMATION;
  return safeValue;
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
  if (text.length <= length) return text;
  const completeSentences = text.match(/[^.!?]+[.!?]+/g)?.map((item) => item.trim()).filter(Boolean) || [];
  if (!completeSentences.length) return text;
  const retained = [];
  for (const sentence of completeSentences) {
    if (retained.length && [...retained, sentence].join(" ").length > length) break;
    retained.push(sentence);
  }
  return retained.join(" ") || completeSentences[0];
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
        ? `The evidenced arithmetic produces a provisional amount of ${amountText(financials.provisional_indemnity, currency)} after the supported valuation uplift and deductions. It is not presented as a concluded indemnity because the remaining adjustment and coverage matters require confirmation: ${financials.requires_confirmation.join("; ") || REQUIRES_CONFIRMATION}.`
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
        return `${masterParagraphs("report_summary_intro")}\n\n| Assured's / Shipper's Name | ${masterData.scalars.summary_assured} |\n| --- | --- |\n| Consignee's Name | ${masterData.scalars.summary_consignee} |\n| Insurance Policy | ${masterData.scalars.summary_policy.replaceAll("\n", "<br>")} |\n\n### In our opinion\n\n${masterList("report_summary_opinion")}`;
      case "introduction":
      case "appointment":
        return `ULA's appointment or instruction details: **${factText(normalizedRecord, "appointment_details", index)}**\n\nThe available file identifies the applicant / instructing party as **${factText(normalizedRecord, applicantField, index)}**, the insurer as **${factText(normalizedRecord, "insurer", index)}**, the insured / assured as **${factText(normalizedRecord, "insured", index)}**, and the relevant transit interest as **${factText(normalizedRecord, "commodity", index)}**. No wider scope or authority is inferred beyond the uploaded evidence.`;
      case "investigation": case "surveyor_notes": case "survey_timeline": case "adjusters_note":
        return `${masterParagraphs("surveyor_notes")}${damageSchedule}`;
      case "interest_insured":
        return masterParagraphs("interest_insured");
      case "routing": case "transport":
        return `${masterParagraphs("shipment_routing")}\n\n| Routing detail | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Country of origin", "country_of_origin"], ["Origin / loading", isPresent(facts.voyage_from.value) ? "voyage_from" : "port_of_loading"], ["Destination country", "destination_country"], ["Destination / discharge", isPresent(facts.voyage_to.value) ? "voyage_to" : "port_of_discharge"], ["Mother vessel", "vessel_name"], ["Mother-vessel voyage", "voyage_number"], ["Transshipment port", "transshipment_port"], ["Feeder vessel", "feeder_vessel"], ["Feeder voyage", "feeder_voyage"], ["Carrier", "carrier"], ["Departure date", "departure_date"], ["Arrival date", "arrival_date"], ["Shipment / on-board date", "shipment_date"], ["Discharge date", "discharge_date"], ["Delivery date", "delivery_date"], ["Empty-container return", "empty_return_date"], ["Bill of lading", "bill_of_lading"], ["Container(s)", "container_numbers"], ["Seal(s)", "seal_numbers"], ["Seal condition", "seal_condition"]])}`;
      case "temperature":
        return `| Cold-chain fact | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Required carrying temperature", "temperature_requirement"], ["Affected container", "affected_container"], ["Affected shipment quantity", "affected_quantity"], ["Commercially unacceptable / salvage-suitable quantity", "salvage_quantity"], ["Total-loss quantity", "total_loss_quantity"], ["Recorded temperature findings", "temperature_findings"], ["Survey findings", "damage_findings"]])}\n\nTemperature records are treated as outstanding unless substantive logger readings or equivalent records are present. A policy temperature condition alone is not a temperature record.`;
      case "cause":
        return masterParagraphs("cause_of_loss_section");
      case "coverage": case "warranties":
        return masterParagraphs("policy_conditions_section");
      case "assessors":
        return masterParagraphs("assessors_section");
      case "insured_value": case "sums_insured": return masterParagraphs("adequacy_section");
      case "adjustment": return `${masterParagraphs("adjustment_intro")}\n\n${financialNarrative}\n\n### Table 2 - Claim presented by the Assured & Adjustment\n\n| Description | Quantity damaged | Unit Price in ${masterData.scalars.currency} | Adjusted Claim Value in ${masterData.scalars.currency} |\n| --- | ---: | ---: | ---: |\n${adjustmentSchedule}\n\n${masterData.scalars.adjustment_total.replaceAll("\n", "  \n")}`;
      case "conclusion":
        return `In our opinion\n\n${masterList("conclusion_items")}`;
      case "supporting_documents": return masterList("enclosure_items");
      case "outstanding_documents": return masterList("outstanding_items");
      case "appendices": return masterData.appendices.length ? masterData.appendices.map((entry) => `### ${entry.heading}\n\n${entry.description}`).join("\n\n") : "No appendix evidence was established in the uploaded file set.";
      case "notice": case "notices":
        return `| Notice detail | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Date of intimation", "date_of_intimation"], ["Notice of claim date", "notice_date"], ["Carrier", "carrier"], ["Bill of lading", "bill_of_lading"], ["Air waybill", "air_waybill"]])}`;
      case "timing": return `${findings}\n\nThe event sequence is evidential, not a determination of when physical damage occurred. Any unsupported damage timing remains open for professional review.`;
      case "weather": return "No weather report or voyage-weather record was identified in the normalized evidence. No weather-related cause is inferred.";
      case "recovery":
        return `| Recovery matter | Evidence-supported value |\n| --- | --- |\n${tableRows(normalizedRecord, index, [["Salvage findings", "salvage_findings"], ["Salvage amount", "salvage_amount"], ["Recovery findings", "recovery_findings"], ["Recovery amount", "recovery_amount"]])}\n\n${masterParagraphs("liability_section")}\n\nUnknown salvage or recovery is not treated as zero.`;
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
  const baseBodySections = uniqueSections(template.sections);
  const shipmentReport = /Marine Cargo|Bulk Vessel|Air Shipment|Land Shipment/i.test(normalizedRecord.business_line || "");
  const reportSections = shipmentReport && !baseBodySections.some((section) => section.id === "routing")
    ? baseBodySections.flatMap((section) => section.id === "interest_insured"
      ? [section, { id: "routing", title: "SHIPMENT ROUTING", owner: "preparer", required: true }]
      : [section])
    : baseBodySections;
  const bodySections = reportSections
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
| ${masterData.scalars.approval_date} |  |  |

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
