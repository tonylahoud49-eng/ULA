import JSZip from "jszip";

export const MASTER_TEMPLATE_NAME = "260536 - CR - Victoire - UTA - 1v1.docx";
export const UNKNOWN_REPORT_VALUE = "Not established from the reviewed evidence";
export const DIRECTOR_ASSESSOR_WORDING = "To date, it is understood that the Assured had not appointed a loss assessor to act on their behalf.";
export const DIRECTOR_CONCLUSION_CLOSING = "We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions.";

const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== "" && !/^(?:requires confirmation|unknown|not established(?: from (?:the )?reviewed evidence)?|null|undefined)$/i.test(String(value).trim());
const unique = (items) => [...new Set(items.filter(Boolean))];
const numberValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!isPresent(value)) return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : null;
};
const OCR_GARBAGE_PATTERNS = [
  /Place\s+of\s+Del\s*iv\s*ery/i,
  /Appl\s*icable\s+only\s+when\s+document\s+used/i,
  /Mul\s*timodal\s+T\s*r\s*ansport/i,
  /page\s+intentionally\s+left\s+blank/i,
  /(?:terms?|conditions?)\s+continued\s+on\s+(?:the\s+)?(?:next|reverse)\s+(?:page|side)/i,
];

const cleanText = (value) => String(value || "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  .replace(/\s+/g, " ")
  .trim();

export function sanitizeReportValue(value, fieldName = "") {
  if (!isPresent(value)) return null;
  let text = cleanText(value);
  if (!text || OCR_GARBAGE_PATTERNS.some((pattern) => pattern.test(text))) return null;
  if ((text.match(/\b[A-Za-z]\b/g) || []).length >= 5) return null;
  if (/\uFFFD|Ã¢â‚¬|Ãƒ|â€[™œ“”]/.test(text)) return null;

  if (["applicant", "insured", "insurer", "reassured", "reinsurer", "broker", "shipper", "consignee", "carrier", "surveyor"].includes(fieldName)) {
    text = text.split(/\s+(?=(?:Invoice|Policy|B\/?L|Bill of Lading|AWB|Container|Tel(?:ephone)?|E-?mail|Address)\s*(?:No\.?|Number|:|#))/i)[0].trim();
    if (!text || /^(?:Invoice|Policy|Bill of Lading|AWB|Container)\b/i.test(text)) return null;
  }
  return text.length > 2_000 ? null : text;
}

const valueOrUnknown = (value, fieldName = "") => sanitizeReportValue(value, fieldName) || UNKNOWN_REPORT_VALUE;
const assignmentOrUnassigned = (value) => isPresent(value) ? cleanText(value) : "Not assigned";

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const tokenXml = (value) => escapeXml(value).split(/\r?\n/).join("</w:t><w:br/><w:t>");

function replaceBlockText(xml, value) {
  const encoded = tokenXml(value);
  let replaced = false;
  const updated = xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, (textNode) => {
    if (replaced) return textNode.replace(/>[^<]*<\/w:t>$/, "></w:t>");
    replaced = true;
    return textNode.replace(/>[^<]*<\/w:t>$/, `>${encoded}</w:t>`);
  });
  if (replaced) return updated;
  return updated.replace(/<\/w:p>$/, `<w:r><w:t>${encoded}</w:t></w:r></w:p>`);
}

function cleanPrototype(xml) {
  return xml
    .replace(/\s+w14:paraId="[^"]*"/g, "")
    .replace(/\s+w14:textId="[^"]*"/g, "")
    .replace(/<w:lastRenderedPageBreak\s*\/>/g, "");
}

function withPageBreakBefore(xml) {
  if (/<w:pPr>/.test(xml)) return xml.replace(/<w:pPr>/, "<w:pPr><w:pageBreakBefore/>");
  return xml.replace(/<w:p\b([^>]*)>/, "<w:p$1><w:pPr><w:pageBreakBefore/></w:pPr>");
}

function asNormalParagraph(xml) {
  return xml
    .replace(/<w:pStyle\b[^>]*\/>/, '<w:pStyle w:val="Normal"/>')
    .replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "");
}

function replaceParagraphMarker(xml, marker, values) {
  const token = `{{${marker}}}`;
  const items = (Array.isArray(values) ? values : [values]).filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!paragraph.includes(token)) return paragraph;
    if (!items.length && ["report_summary_findings", "document_sighting"].includes(marker)) return "";
    const prototype = cleanPrototype(paragraph);
    const resolved = items.length ? items : [UNKNOWN_REPORT_VALUE];
    return resolved.map((value) => replaceBlockText(prototype, value)).join("");
  });
}

const decodeXmlText = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'");

function removeParagraphContainingText(xml, requiredText) {
  const normalizedRequired = cleanText(requiredText).toLowerCase();
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = decodeXmlText([...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join(""));
    return cleanText(text).toLowerCase().includes(normalizedRequired) ? "" : paragraph;
  });
}

function replaceScalarTokens(xml, scalars) {
  let result = xml;
  for (const [key, value] of Object.entries(scalars)) result = result.replaceAll(`{{${key}}}`, tokenXml(value));
  return result;
}

function replaceDynamicTableRows(xml, marker, rows, keys) {
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
    if (!table.includes(`{{${marker}}}`)) return table;
    const rowMatches = [...table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
    const prototypeMatch = rowMatches.find((match) => match[0].includes(`{{${marker}}}`));
    if (!prototypeMatch) return table;
    const prototype = cleanPrototype(prototypeMatch[0]);
    const resolvedRows = rows.length ? rows : [Object.fromEntries(keys.map((key) => [key, UNKNOWN_REPORT_VALUE]))];
    const replacement = resolvedRows.map((row) => {
      let generated = prototype;
      for (const key of keys) generated = generated.replaceAll(`{{${key}}}`, tokenXml(row[key] ?? UNKNOWN_REPORT_VALUE));
      return generated;
    }).join("");
    return `${table.slice(0, prototypeMatch.index)}${replacement}${table.slice(prototypeMatch.index + prototypeMatch[0].length)}`;
  });
}

const SMALL_NUMBERS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function integerWords(value) {
  const number = Math.floor(Math.abs(value));
  if (number < 20) return SMALL_NUMBERS[number];
  if (number < 100) return `${TENS[Math.floor(number / 10)]}${number % 10 ? `-${SMALL_NUMBERS[number % 10]}` : ""}`;
  if (number < 1_000) return `${SMALL_NUMBERS[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${integerWords(number % 100)}` : ""}`;
  if (number < 1_000_000) return `${integerWords(Math.floor(number / 1_000))} Thousand${number % 1_000 ? ` ${integerWords(number % 1_000)}` : ""}`;
  if (number < 1_000_000_000) return `${integerWords(Math.floor(number / 1_000_000))} Million${number % 1_000_000 ? ` ${integerWords(number % 1_000_000)}` : ""}`;
  return number.toLocaleString("en-US");
}

function amountWords(value, currency) {
  const number = numberValue(value);
  if (number === null) return UNKNOWN_REPORT_VALUE;
  const cents = Math.round((Math.abs(number) - Math.floor(Math.abs(number))) * 100);
  return `${currency || "Currency"} ${integerWords(number)}${cents ? ` & ${String(cents).padStart(2, "0")}/100` : ""} Only`;
}

const sourceLabel = (sources = []) => {
  const labels = unique(sources.map((source) => {
    if (!source.document_name) return null;
    return source.page ? `${source.document_name}, page ${source.page}` : source.document_name;
  }));
  return labels.length ? ` (Source: ${labels.join("; ")})` : "";
};

const fact = (record, name) => {
  const resolved = record?.facts?.[name] || { value: null, sources: [] };
  return { ...resolved, value: sanitizeReportValue(resolved.value, name) };
};
const factValue = (record, name) => valueOrUnknown(fact(record, name).value, name);
const factWithSource = (record, name) => factValue(record, name);
const amount = (value, currency) => {
  const number = numberValue(value);
  return number === null ? UNKNOWN_REPORT_VALUE : `${currency || ""} ${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};

function evidenceUnit(record, name) {
  const text = (fact(record, name).sources || []).map((source) => source.supporting_text || "").join(" ");
  return text.match(/\b(cartons?|boxes?|packages?|crates?|units?|pieces?)\b/i)?.[1] || "units";
}

function findingSentences(record) {
  return unique((record?.evidence_findings || []).flatMap((item) => {
    const finding = sanitizeReportValue(item.finding);
    if (!finding) return [];
    return [finding
      .replace(/^(?:the\s+)?(?:uploaded\s+)?(?:document|evidence|claim file)\s+(?:states|records|reports|shows|notes|identifies)\s+(?:that\s+)?/i, "")
      .replace(/^according to (?:the )?(?:uploaded )?(?:document|evidence|claim file),?\s*/i, "")];
  }));
}

function chronologySentences(record) {
  return (record?.chronology || []).map((event) => `${event.date}: ${event.label}`);
}

const asSentence = (value) => {
  const text = cleanText(value);
  return !text || /[.!?]$/.test(text) ? text : `${text}.`;
};

const joinSentences = (values, limit = 4) => unique(values.filter(Boolean)).slice(0, limit).map(asSentence).join(" ");

const MATERIAL_CONFLICT_FIELDS = new Set([
  "insured", "consignee", "policy_number", "date_of_loss", "departure_date", "arrival_date", "delivery_date",
  "quantity", "affected_quantity", "shortage_breakdown", "claim_amount", "gross_claim_amount", "adjusted_amount",
  "deductible", "salvage_amount", "recovery_amount", "valuation_basis", "cause_of_loss",
]);

function professionalConflict(record, conflict) {
  const field = String(conflict?.field || "");
  if (!MATERIAL_CONFLICT_FIELDS.has(field)) return null;
  if (["quantity", "affected_quantity", "shortage_breakdown"].includes(field)) {
    return "There remains a discrepancy between the quantity claimed and the quantity recorded during the survey or supporting records; this should be reconciled before the adjustment is finalised.";
  }
  if (["claim_amount", "gross_claim_amount", "adjusted_amount", "deductible", "salvage_amount", "recovery_amount", "valuation_basis"].includes(field)) {
    return `The available records do not present a consistent ${field.replaceAll("_", " ")}; the applicable figure should be agreed before the adjustment is finalised.`;
  }
  if (["date_of_loss", "departure_date", "arrival_date", "delivery_date"].includes(field)) {
    return `The recorded ${field.replaceAll("_", " ")} is not consistent across the claim file and should be confirmed where it affects the policy period or loss chronology.`;
  }
  if (["insured", "consignee"].includes(field)) {
    return `The identity of the ${field} is not presented consistently and should be confirmed before the report is issued.`;
  }
  if (field === "policy_number") return "The applicable policy reference is not presented consistently and should be confirmed against the operative policy wording.";
  if (field === "cause_of_loss") return "The records contain differing descriptions of the cause; the physical and circumstantial findings set out above should govern the final causal assessment.";
  return null;
}

function surveyorNarrative(record) {
  const findings = findingSentences(record);
  const categories = [
    ["Shipment and transit", /shipment|transit|vessel|voyage|arrival|delivery|unload|discharg|warehouse|container/i],
    ["Container and seal condition", /seal|tamper|forced entry|container condition|door|roof|side panel|corrosion/i],
    ["Survey observations and extent of loss", /damage|broken|crack|deteriorat|wet|shortage|missing|quantity|survey|inspection|carton|cargo/i],
    ["Packing and protection", /pack|carton|foam|pallet|dunnage|cushion|protect|secur|stow/i],
    ["Carrier, recovery and adjustment considerations", /carrier|attendance|certificate|salvage|recovery|discrep|claimed|invoice|count/i],
  ];
  const used = new Set();
  const paragraphs = [];
  const chronology = chronologySentences(record);
  if (chronology.length) paragraphs.push(`Material chronology. ${joinSentences(chronology, 6)}`);
  for (const [heading, pattern] of categories) {
    const matching = findings.filter((item) => pattern.test(item) && !used.has(item)).slice(0, 4);
    matching.forEach((item) => used.add(item));
    if (matching.length) paragraphs.push(`${heading}. ${joinSentences(matching)}`);
  }
  const remaining = findings.filter((item) => !used.has(item)).slice(0, 3);
  if (remaining.length) paragraphs.push(`Additional material observations. ${joinSentences(remaining, 3)}`);
  if (!paragraphs.length) paragraphs.push("No reliable survey observation was established from the available information.");
  return paragraphs;
}

function causeNarrative(record) {
  const assessment = record?.cause_assessment || {};
  const hypotheses = assessment.hypotheses || [];
  const allFindings = findingSentences(record);
  const opinions = allFindings.filter((item) => /in our opinion|on balance|appear(?:s)? consistent|likely attributable|most probable|available circumstances suggest|we consider|cannot be excluded|plausible (?:cause|mechanism|explanation)/i.test(item));
  const observations = unique((assessment.observations || []).map((item) => sanitizeReportValue(item.finding)).filter((item) => item && !opinions.includes(item)));
  const indicators = unique((assessment.indicators || []).map((item) => sanitizeReportValue(item.finding)).filter((item) => item && !opinions.includes(item) && !observations.includes(item)));
  const limitations = allFindings.filter((item) => /not (?:witnessed|verified|established)|unable to|cannot determine|did not attend|abstained|discrep|only .*count|discovered|became visible|no (?:contemporaneous|carrier|independent)/i.test(item));
  const paragraphs = [];
  const leading = hypotheses.find((hypothesis) => ["supported_by_available_evidence", "comparatively_more_plausible"].includes(hypothesis.status));

  if (assessment.explicit_cause?.value) {
    paragraphs.push(`The proximate cause of loss is ${cleanText(assessment.explicit_cause.value)}.`);
  } else if (opinions.length || assessment.reasoned_inference || leading) {
    paragraphs.push("The proximate cause of loss is not expressly established as a source fact; the available evidence supports the qualified professional assessment set out below.");
  } else {
    paragraphs.push("The proximate cause of loss is not established from the available evidence.");
  }

  if (observations.length) {
    paragraphs.push(`The material physical and survey circumstances are as follows: ${joinSentences(observations, 4)}`);
  }
  if (indicators.length) {
    paragraphs.push(`The causal significance of those circumstances lies principally in the following indicators: ${joinSentences(indicators, 4)}`);
  }
  if (opinions.length) {
    paragraphs.push(joinSentences(opinions, 3));
  } else if (assessment.explicit_cause?.value) {
    paragraphs.push("This cause conclusion is confined to the circumstances established in the claim file and remains subject to professional policy review.");
  } else if (assessment.reasoned_inference) {
    paragraphs.push(`In our opinion, ${asSentence(assessment.reasoned_inference).replace(/^The\s+/, "the ")}`);
  } else {
    if (leading) paragraphs.push(`On the available evidence, ${cleanText(leading.hypothesis).toLowerCase()} is ${leading.status === "comparatively_more_plausible" ? "comparatively more plausible than the tested alternatives" : "supported as a provisional causal hypothesis"}. ${cleanText(leading.assessment)}`);
  }
  const competing = hypotheses.filter((hypothesis) => !["evidence_stated", "reasoned_professional_opinion", "supported_by_available_evidence", "comparatively_more_plausible"].includes(hypothesis.status));
  if (competing.length) paragraphs.push(`Competing explanations remain subject to review: ${competing.slice(0, 3).map((hypothesis) => `${cleanText(hypothesis.hypothesis)} (${hypothesis.status.replaceAll("_", " ")})`).join("; ")}.`);
  if (limitations.length) {
    paragraphs.push(`The strength of that opinion is limited by the following material considerations: ${joinSentences(limitations, 3)}`);
  } else if (!assessment.explicit_cause && assessment.evidence_gap && !assessment.reasoned_inference) {
    paragraphs.push("The available information does not establish a definitive proximate cause; a stronger opinion would require unsupported assumptions and alternative mechanisms remain open.");
  }
  return paragraphs.slice(0, 5);
}

function damageRows(record) {
  const rows = [];
  for (const [fieldName, description] of [
    ["salvage_quantity", "Cargo recorded with quality deterioration / salvage consideration"],
    ["total_loss_quantity", "Cargo recorded as extensively deteriorated / total loss"],
  ]) {
    const field = fact(record, fieldName);
    if (!isPresent(field.value)) continue;
    rows.push({
      damage_description: description,
      damage_quantity: `${field.value} ${evidenceUnit(record, fieldName)}`,
      damage_packing: "As recorded in the cited survey evidence",
    });
  }
  if (!rows.length && isPresent(fact(record, "affected_quantity").value)) {
    rows.push({
      damage_description: "Affected cargo identified in the survey evidence",
      damage_quantity: `${fact(record, "affected_quantity").value} ${evidenceUnit(record, "affected_quantity")}`,
      damage_packing: "As recorded in the cited survey evidence",
    });
  }
  return rows;
}

function adjustmentRows(record) {
  if (Array.isArray(record?.adjustment?.line_items) && record.adjustment.line_items.length) {
    return record.adjustment.line_items.map((item) => ({
      adjustment_description: valueOrUnknown(item.description),
      adjustment_quantity: valueOrUnknown(item.quantity),
      adjustment_unit_price: amount(item.unit_price, record.financials?.currency),
      adjustment_value: amount(item.adjusted_value, record.financials?.currency),
    }));
  }
  const financials = record?.financials || {};
  const quantity = fact(record, "affected_quantity").value || fact(record, "quantity").value;
  return [{
    adjustment_description: isPresent(fact(record, "claim_basis").value)
      ? fact(record, "claim_basis").value
      : isPresent(fact(record, "commodity").value) ? fact(record, "commodity").value : "Presented claim quantum",
    adjustment_quantity: valueOrUnknown(quantity),
    adjustment_unit_price: UNKNOWN_REPORT_VALUE,
    adjustment_value: amount(financials.presented_claim, financials.currency),
  }];
}

function adjustmentTotal(record) {
  const financials = record?.financials || {};
  const currency = financials.currency;
  const lines = [`Adjusted Claim Amount ${"-".repeat(55)} ${amount(financials.adjusted_claim_amount ?? financials.presented_claim, currency)}`];
  if (numberValue(financials.valuation_uplift_amount) !== null) {
    const upliftLabel = `Add, Policy Valuation Uplift${numberValue(financials.valuation_uplift_percent) !== null ? ` (${financials.valuation_uplift_percent}%)` : ""}`;
    lines.push(`${upliftLabel} ${"-".repeat(Math.max(8, 65 - upliftLabel.length))} ${amount(financials.valuation_uplift_amount, currency)}`);
    lines.push(`Claim after Valuation Uplift ${"-".repeat(45)} ${amount(financials.claim_after_valuation_uplift, currency)}`);
  }
  for (const [label, value] of [
    ["Less, Deductible / Excess", financials.deductible],
    ["Less, Salvage", financials.salvage],
    ["Less, Recovery", financials.recovery],
    ["Less, Depreciation", financials.depreciation],
  ]) {
    if (numberValue(value) !== null) lines.push(`${label} ${"-".repeat(Math.max(8, 65 - label.length))} (${amount(Math.abs(value), currency)})`);
  }
  if (numberValue(financials.concluded_indemnity) === null && numberValue(financials.provisional_indemnity) !== null) {
    lines.push(`Provisional Amount after Supported Adjustments ${"-".repeat(22)} ${amount(financials.provisional_indemnity, currency)}`);
  }
  lines.push(`Concluded Indemnity ${"-".repeat(54)} ${amount(financials.concluded_indemnity, currency)}`);
  if (numberValue(financials.concluded_indemnity) !== null) lines.push(`Say, ${amountWords(financials.concluded_indemnity, currency)}`);
  else lines.push("A concluded indemnity cannot be calculated without unsupported assumptions.");
  return lines.join("\n");
}

function policyParagraphs(record) {
  const paragraphs = [];
  const terms = fact(record, "warranties_conditions").value || fact(record, "policy_terms").value;
  if (isPresent(terms)) paragraphs.push(`The relevant policy terms and conditions include: ${cleanText(terms)}${sourceLabel([...(fact(record, "warranties_conditions").sources || []), ...(fact(record, "policy_terms").sources || [])])}`);
  for (const entry of record?.policy_analysis?.entries || []) {
    paragraphs.push(`${entry.topic}: ${entry.assessment}${entry.review_question ? ` Review question: ${entry.review_question}` : ""}`);
  }
  const timing = (record?.validation_checks || []).find((check) => check.id === "policy-timing");
  if (timing && !paragraphs.some((paragraph) => paragraph.includes(timing.statement))) paragraphs.push(timing.statement);
  if (!paragraphs.length) paragraphs.push("The available evidence does not contain substantive policy wording sufficient for a warranties or conditions assessment.");
  paragraphs.push("No breach, exclusion, coverage, or liability conclusion is made unless it is directly supported by the cited policy wording and claim evidence.");
  return paragraphs;
}

function liabilityParagraphs(record) {
  const issues = record?.liability_analysis?.issues || [];
  if (!issues.length) return ["No specific liability or recovery route is established from the reviewed evidence; this remains subject to professional review if further contractual or third-party material becomes available."];
  return issues.map((issue) => `${issue.issue}: ${issue.assessment}${issue.material_gaps?.length ? ` Material evidence still required: ${issue.material_gaps.join("; ")}.` : ""}`);
}

function conclusionParagraphs(record) {
  const financials = record?.financials || {};
  const cause = causeNarrative(record);
  const adjustedAmount = numberValue(financials.adjusted_claim_amount);
  const currency = String(financials.currency || "").toUpperCase();
  const scheduleCheck = (record?.validation_checks || []).find((check) => check.id === "claim-schedule-total");
  const adjustedFactSupported = fact(record, "adjusted_amount").status === "supported";
  const scheduleSupported = (record?.adjustment?.line_items || []).length > 0 && scheduleCheck?.status === "validated";
  const amountSupported = adjustedAmount !== null && currency === "USD" && (adjustedFactSupported || scheduleSupported) && (financials.arithmetic_valid || scheduleSupported);
  const amountPoint = amountSupported
    ? `The above adjusted claim amount USD ${amount(adjustedAmount, "USD").replace(/^USD\s+/, "")} is considered fair & reasonable.`
    : "The above adjusted claim amount in USD cannot be stated as fair & reasonable because a fully supported and reconciled USD adjusted amount is not established from the reviewed evidence.";
  const causeOpinion = cause.find((paragraph) => /in our opinion|on balance|likely|most probable|reported cause|proximate cause of loss is/i.test(paragraph)) || cause[0];
  const causePoint = causeOpinion || "The proximate cause of loss is not established from the available evidence.";
  const coverageFinding = (record?.evidence_findings || []).find((finding) => /\bcover(?:age|ed)?\b|policy (?:responds|applies)|warranty|exclusion/i.test(finding.finding || "") && (finding.sources || []).length);
  const coverPoint = coverageFinding
    ? `Cover advice: ${cleanText(coverageFinding.finding)} This remains subject to the operative policy wording and professional approval.`
    : record?.policy_analysis?.has_wording
      ? "Cover advice: The identified policy warranties, exclusions, valuation provisions, and other operative terms must be applied to the established facts before cover is confirmed; final cover remains subject to professional review and approval."
      : "Cover advice: The operative policy wording is not established from the reviewed evidence, so cover cannot be advised without inventing terms and remains subject to professional review.";
  const recoveryIssue = (record?.liability_analysis?.issues || []).find((issue) => issue.issue === "Potential carrier or contractual recovery" && issue.status === "evidence_available_for_review");
  const liabilityPoint = recoveryIssue
    ? `Liable-party position: ${recoveryIssue.assessment} No liable party is held automatically without the supporting contract, notice, causation, and liability evidence.`
    : "Liable-party position: No liable party is established from the reviewed evidence; no recovery allegation is made, and any potential rights remain subject to further evidence and professional review.";
  return [amountPoint, causePoint, coverPoint, liabilityPoint, DIRECTOR_CONCLUSION_CLOSING];
}

export function buildMasterReportData({ report = {}, claim = {}, issueDate } = {}) {
  const record = report.normalized_claim_record || claim.normalized_claim_record || {};
  const financials = record.financials || {};
  const currency = financials.currency || report.currency || claim.currency || "";
  const resolvedIssueDate = issueDate || report.issue_date || new Date(report.approved_date || report.created_date || Date.now()).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const insured = fact(record, "insured").value || report.insured_name || claim.insured;
  const applicant = fact(record, "applicant").value || report.applicant || claim.applicant || fact(record, "insurer").value || report.insurer || claim.insurer;
  const insurer = fact(record, "insurer").value || report.insurer || claim.insurer;
  const consignee = fact(record, "consignee").value;
  const policyNumber = fact(record, "policy_number").value || report.policy_number || claim.policy_number;
  const commodity = fact(record, "commodity").value;
  const from = fact(record, "voyage_from").value || fact(record, "port_of_loading").value || fact(record, "country_of_origin").value;
  const to = fact(record, "voyage_to").value || fact(record, "port_of_discharge").value || fact(record, "destination_country").value;
  const transportReference = fact(record, "bill_of_lading").value || fact(record, "air_waybill").value;
  const transportLabel = isPresent(fact(record, "bill_of_lading").value) ? "Bill of Lading" : "Air Waybill";
  const policyValue = fact(record, "insured_value").value || fact(record, "policy_limit").value;
  const policyTerms = fact(record, "policy_terms").value || fact(record, "warranties_conditions").value;
  const surveyorNotes = surveyorNarrative(record);
  const causeSection = causeNarrative(record);
  const conclusions = conclusionParagraphs(record);
  const documentRegister = record.document_register || [];
  const receivedDocuments = documentRegister.map((document) => `${document.document_name} - ${document.categories?.join(", ") || "document type not established"}`);
  const selectedPhotoDocuments = new Set((record.selected_photographs || []).map((item) => item.document_id));
  const appendixDocuments = selectedPhotoDocuments.size
    ? (record.appendices || []).filter((document) => selectedPhotoDocuments.has(document.document_id))
    : (record.appendices || []);
  const appendices = appendixDocuments.map((document, index) => ({
    document_id: document.document_id,
    document_name: document.document_name,
    heading: `Appendix ${String.fromCharCode(65 + index)} - ${document.categories?.includes("Photographs") ? "Photographs / Visual Evidence" : "Supporting Evidence"}`,
    description: `${document.document_name}; ${document.image_only_pages || 0} image-only page(s) and ${document.searchable_pages || 0} searchable page(s) registered.`,
  }));
  const assignments = Object.fromEntries((report.assignments || []).map((assignment) => [assignment.role, assignment]));
  const policyDetails = [
    `No. ${valueOrUnknown(policyNumber)}`,
    `Insured Value / Limit: ${amount(policyValue, currency)}`,
    isPresent(policyTerms) ? cleanText(policyTerms) : "Policy wording was not established in the reviewed evidence",
    isPresent(fact(record, "valuation_basis").value) ? `Basis of Valuation: ${cleanText(fact(record, "valuation_basis").value)}` : null,
    `Deductible / Excess: ${amount(financials.deductible, currency)}`,
  ].filter(Boolean).join("\n");
  const cargoParts = [fact(record, "container_numbers").value, fact(record, "quantity").value, commodity, fact(record, "gross_weight").value].filter(isPresent);
  const arrivalParts = [fact(record, "discharge_date").value && `Discharged ${fact(record, "discharge_date").value}`, fact(record, "arrival_date").value && `Arrived ${fact(record, "arrival_date").value}`, fact(record, "delivery_date").value && `Delivered ${fact(record, "delivery_date").value}`].filter(Boolean);
  const documentedInsuredValue = numberValue(fact(record, "insured_value").value);
  const invoiceValueForAdequacy = numberValue(financials.invoice_value);
  const valuationUpliftPercent = numberValue(financials.valuation_uplift_percent);
  const valuationBasisKnown = isPresent(financials.valuation_basis) || valuationUpliftPercent !== null;
  const valuationBasisSupported = fact(record, "valuation_basis").status === "supported"
    || fact(record, "valuation_uplift_percent").status === "supported";
  const adequacyComparable = documentedInsuredValue !== null
    && fact(record, "insured_value").status === "supported"
    && invoiceValueForAdequacy !== null
    && fact(record, "invoice_total").status === "supported"
    && isPresent(currency)
    && fact(record, "currency").status === "supported"
    && valuationBasisKnown
    && valuationBasisSupported;
  const requiredInsuredValue = adequacyComparable
    ? invoiceValueForAdequacy * (1 + (valuationUpliftPercent || 0) / 100)
    : null;
  const adequatelyInsured = adequacyComparable && documentedInsuredValue + 0.01 >= requiredInsuredValue;
  const adequacySource = sourceLabel([
    ...(fact(record, "invoice_total").sources || []),
    ...(fact(record, "insured_value").sources || []),
    ...(fact(record, "valuation_basis").sources || []),
    ...(fact(record, "valuation_uplift_percent").sources || []),
  ]);
  const adequacy = adequacyComparable
    ? adequatelyInsured
      ? `The documented invoice value is ${amount(invoiceValueForAdequacy, currency)}${valuationUpliftPercent !== null ? ` and the evidenced valuation basis requires a ${valuationUpliftPercent}% uplift, producing a value at risk of ${amount(requiredInsuredValue, currency)}` : ""}. The documented insured value is ${amount(documentedInsuredValue, currency)}. Accordingly, the invoice values are adequately insured and there is no underinsurance on the evidenced valuation basis.${adequacySource}`
      : `The documented invoice value is ${amount(invoiceValueForAdequacy, currency)}${valuationUpliftPercent !== null ? ` and the evidenced valuation basis requires a ${valuationUpliftPercent}% uplift, producing a value at risk of ${amount(requiredInsuredValue, currency)}` : ""}. The documented insured value is ${amount(documentedInsuredValue, currency)}. Accordingly, the invoice values are not adequately insured and there is underinsurance of ${amount(requiredInsuredValue - documentedInsuredValue, currency)} on the evidenced valuation basis.${adequacySource}`
    : "Whether the invoice values are adequately insured and whether there is underinsurance cannot be established from the available evidence because a comparable invoice value, insured value, currency, and evidenced valuation basis are not all available.";
  const preservedIntroduction = sanitizeReportValue(fact(record, "report_introduction").value, "report_introduction");
  const summaryIntro = preservedIntroduction || `At the request of ${valueOrUnknown(applicant)} (the Applicant), ULA was requested to investigate a ${valueOrUnknown(record.business_line || report.business_line || claim.business_line)} claim for ${valueOrUnknown(insured)} (the Assured), establish the circumstances and extent of loss, and adjust the claim presented under the policy. The insured interest is ${valueOrUnknown(commodity)}.`;
  const table1BriefParts = [
    isPresent(insured) ? `${cleanText(insured)} as the Assured` : null,
    isPresent(commodity) ? `${cleanText(commodity)} as the insured interest` : null,
    isPresent(from) && isPresent(to) ? `movement from ${cleanText(from)} to ${cleanText(to)}` : null,
    isPresent(policyNumber) ? `Policy No. ${cleanText(policyNumber)}` : null,
  ].filter(Boolean);
  const table1Brief = table1BriefParts.length
    ? `In brief, Table 1 records ${table1BriefParts.join(", ")}.`
    : "In brief, Table 1 records the material claim details established from the reviewed evidence.";
  const noteIntro = `${summaryIntro} This report and adjustment note sets out our findings, causal assessment and adjustment position; the records reviewed are listed in the enclosure section.`;
  const invoiceComponents = [
    financials.fob_value !== null ? `FOB ${amount(financials.fob_value, currency)}` : null,
    financials.freight_amount !== null ? `freight ${amount(financials.freight_amount, currency)}` : null,
    financials.insurance_amount !== null ? `insurance ${amount(financials.insurance_amount, currency)}` : null,
  ].filter(Boolean);
  const valuationNarrative = financials.invoice_value !== null
    ? `Commercial invoice ${valueOrUnknown(fact(record, "invoice_number").value)} records ${invoiceComponents.length ? `${invoiceComponents.join(", ")}, and ` : ""}a total value of ${amount(financials.invoice_value, currency)}. These source valuations are not substituted for an absent presented claim.`
    : "The available evidence does not establish a commercial-invoice value suitable for reproduction in the adjustment.";
  const presentedClaimNarrative = financials.presented_claim !== null
    ? `The gross claim of ${amount(financials.presented_claim, currency)} was presented${sourceLabel([...(fact(record, "claim_amount").sources || []), ...(fact(record, "gross_claim_amount").sources || [])])}.`
    : "The reviewed evidence does not state a gross presented claim quantum.";
  const adjustedClaimNarrative = financials.adjusted_claim_amount !== null && financials.presented_claim !== null
    && numberValue(financials.adjusted_claim_amount) !== numberValue(financials.presented_claim)
    ? `The damaged quantities were reconciled against the insured commercial-invoice unit prices, producing an adjusted claim amount of ${amount(financials.adjusted_claim_amount, currency)}. The deterministic valuation adjustment is ${amount(financials.valuation_adjustment, currency)}.`
    : null;
  const valuationUpliftNarrative = financials.valuation_uplift_amount !== null
    ? `The evidenced valuation basis adds ${financials.valuation_uplift_percent !== null ? `${financials.valuation_uplift_percent}%` : "the stated uplift"}, equal to ${amount(financials.valuation_uplift_amount, currency)}, producing ${amount(financials.claim_after_valuation_uplift, currency)} before deductible and other supported deductions.`
    : null;
  const freightInvoiceNarrative = financials.freight_invoice_value !== null
    ? `Separate freight invoice ${valueOrUnknown(fact(record, "freight_invoice_number").value)} records ${amount(financials.freight_invoice_value, currency)} and is retained as a source valuation, not automatically treated as a claim item.`
    : null;
  const calculationFindings = (record.validation_checks || [])
    .filter((check) => ["invoice-components", "insured-valuation-basis", "affected-quantity", "shipment-quantity"].includes(check.id))
    .map((check) => check.statement);
  return {
    scalars: {
      cover_title: `${valueOrUnknown(applicant)} - ${valueOrUnknown(insured)} - ${valueOrUnknown(claim.title || commodity)}`,
      claim_number: valueOrUnknown(report.claim_number || claim.claim_number),
      version_number: valueOrUnknown(report.version_number || 1),
      insurer: valueOrUnknown(applicant),
      actual_insurer: valueOrUnknown(insurer),
      insured_name: valueOrUnknown(insured),
      policy_number: valueOrUnknown(policyNumber),
      issue_date: resolvedIssueDate,
      issue_year: String(new Date(report.approved_date || report.created_date || Date.now()).getFullYear()),
      preparer_name: assignmentOrUnassigned(assignments.preparer?.name || report.preparer_name || claim.prepared_by),
      reviewer_name: assignmentOrUnassigned(assignments.reviewer?.name || report.reviewer_name || claim.reviewed_by),
      approver_name: assignmentOrUnassigned(assignments.approver?.name || report.approver_name || claim.approved_by),
      preparer_designation: assignmentOrUnassigned(assignments.preparer?.designation || report.preparer_designation),
      reviewer_designation: assignmentOrUnassigned(assignments.reviewer?.designation || report.reviewer_designation),
      approver_designation: assignmentOrUnassigned(assignments.approver?.designation || report.approver_designation),
      revision_reason: valueOrUnknown(report.notes || "Initial controlled draft"),
      summary_assured: valueOrUnknown(fact(record, "shipper").value || insured),
      summary_consignee: valueOrUnknown(consignee),
      summary_policy: policyDetails,
      policy_details: policyDetails,
      incoterm: factWithSource(record, "incoterm"),
      transport_document: `${transportLabel}: ${valueOrUnknown(transportReference)}`,
      shipper: factWithSource(record, "shipper"),
      consignee: factWithSource(record, "consignee"),
      cargo_details: valueOrUnknown(cargoParts.join("; ")),
      routing_details: `${valueOrUnknown(from)} / ${valueOrUnknown(to)}`,
      carrier_details: valueOrUnknown([
        fact(record, "vessel_name").value && `${fact(record, "vessel_name").value}${isPresent(fact(record, "voyage_number").value) ? ` / ${fact(record, "voyage_number").value}` : ""}`,
        fact(record, "feeder_vessel").value && `Feeder ${fact(record, "feeder_vessel").value}${isPresent(fact(record, "feeder_voyage").value) ? ` / ${fact(record, "feeder_voyage").value}` : ""}`,
        fact(record, "carrier").value,
      ].filter(isPresent).join("; ")),
      arrival_delivery_details: valueOrUnknown(arrivalParts.join("; ")),
      currency: currency || "Currency",
      adjustment_total: adjustmentTotal(record),
      contact_details: `United Kingdom: 71-75 Shelton Street, Covent Garden | London, England - WC2H 9JQ\nMiddle East: Mina Tower, Ain Warda Street | Beirut, Lebanon - WG2G+5CX`,
    },
    paragraphs: {
      report_summary_intro: [summaryIntro, table1Brief],
      report_summary_findings: [],
      report_summary_opinion: conclusions,
      document_sighting: [],
      report_note_intro: [noteIntro],
      interest_insured: [`${valueOrUnknown(commodity)} was documented for transit from ${valueOrUnknown(from)} to ${valueOrUnknown(to)} under Policy No. ${valueOrUnknown(policyNumber)}.`],
      surveyor_notes: surveyorNotes,
      cause_of_loss_section: causeSection,
      policy_conditions_section: policyParagraphs(record),
      liability_section: liabilityParagraphs(record),
      adequacy_section: [adequacy],
      assessors_section: [DIRECTOR_ASSESSOR_WORDING],
      adjustment_intro: [
        `${presentedClaimNarrative} Source valuations are not substituted for an absent claim quantum, and unknown deductions are not treated as zero.`,
        adjustedClaimNarrative,
        valuationUpliftNarrative,
        valuationNarrative,
        freightInvoiceNarrative,
        ...calculationFindings,
      ].filter(Boolean),
      conclusion_items: conclusions,
      enclosure_items: receivedDocuments,
      outstanding_items: record.evidence_gaps?.length
        ? record.evidence_gaps.map((gap) => `${gap.gap} — ${gap.impact}`)
        : record.outstanding_documents || [],
    },
    damage_rows: damageRows(record),
    adjustment_rows: adjustmentRows(record),
    appendices,
  };
}

function appendRelationship(xml, id, target) {
  return xml.replace(/<\/Relationships>/, `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/></Relationships>`);
}

function ensureContentType(xml, extension, contentType) {
  if (new RegExp(`<Default\\b[^>]*Extension="${extension}"`, "i").test(xml)) return xml;
  return xml.replace(/<\/Types>/, `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
}

async function addAppendixImages(zip, images) {
  if (!images.length) return [];
  const relsName = "word/_rels/document.xml.rels";
  let rels = await zip.file(relsName).async("string");
  const existingIds = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  let nextId = Math.max(0, ...existingIds) + 1;
  let contentTypes = await zip.file("[Content_Types].xml").async("string");
  const resolved = [];
  for (const [index, image] of images.entries()) {
    const extension = image.extension || (image.content_type === "image/jpeg" ? "jpg" : "png");
    const contentType = image.content_type || (extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png");
    const filename = `ula-appendix-${String(index + 1).padStart(3, "0")}.${extension}`;
    const relationshipId = `rId${nextId}`;
    nextId += 1;
    zip.file(`word/media/${filename}`, image.data);
    rels = appendRelationship(rels, relationshipId, `media/${filename}`);
    contentTypes = ensureContentType(contentTypes, extension, contentType);
    resolved.push({ ...image, relationship_id: relationshipId });
  }
  zip.file(relsName, rels);
  zip.file("[Content_Types].xml", contentTypes);
  return resolved;
}

function replaceAppendixArea(xml, appendices, images) {
  const paragraphMatches = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const heading = paragraphMatches.find((match) => match[0].includes("{{appendices}}"));
  const image = paragraphMatches.find((match) => match[0].includes("{{appendix_image}}"));
  if (!heading || !image) return xml;
  const headingPrototype = cleanPrototype(heading[0]);
  const imagePrototype = cleanPrototype(image[0]);
  const normalPrototype = asNormalParagraph(headingPrototype);
  const entries = appendices.length ? appendices : [{ heading: "Appendices / Photographs", description: "No photographic or appendix evidence was established in the uploaded file set." }];
  const generated = entries.map((entry, entryIndex) => {
    const pageHeading = replaceBlockText(entryIndex ? withPageBreakBefore(headingPrototype) : headingPrototype, entry.heading);
    const matchingImages = images.filter((item) => item.document_id === entry.document_id || item.document_name === entry.document_name);
    if (!matchingImages.length) return `${pageHeading}${replaceBlockText(normalPrototype, entry.description)}`;
    return `${pageHeading}${matchingImages.map((item) => {
      const imageBlock = replaceBlockText(imagePrototype.replaceAll("rId20", item.relationship_id), "");
      const caption = replaceBlockText(normalPrototype, valueOrUnknown(item.caption));
      return `${imageBlock}${caption}`;
    }).join("")}`;
  }).join("");
  return `${xml.slice(0, heading.index)}${generated}${xml.slice(image.index + image[0].length)}`;
}

export async function populateMasterReportDocx(templateData, context, { appendixImages = [] } = {}) {
  const zip = await JSZip.loadAsync(templateData);
  const data = buildMasterReportData(context);
  const resolvedImages = await addAppendixImages(zip, appendixImages);
  const documentEntry = zip.file("word/document.xml");
  if (!documentEntry) throw new Error("The ULA master template has no document body.");
  let documentXml = await documentEntry.async("string");
  for (const [marker, paragraphs] of Object.entries(data.paragraphs)) documentXml = replaceParagraphMarker(documentXml, marker, paragraphs);
  documentXml = removeParagraphContainingText(documentXml, "The following was concluded:");
  documentXml = removeParagraphContainingText(documentXml, "End of adjustment note.");
  documentXml = replaceDynamicTableRows(documentXml, "damage_description", data.damage_rows, ["damage_description", "damage_quantity", "damage_packing"]);
  documentXml = replaceDynamicTableRows(documentXml, "adjustment_description", data.adjustment_rows, ["adjustment_description", "adjustment_quantity", "adjustment_unit_price", "adjustment_value"]);
  documentXml = replaceAppendixArea(documentXml, data.appendices, resolvedImages);
  documentXml = replaceScalarTokens(documentXml, data.scalars);
  zip.file("word/document.xml", documentXml);

  for (const name of Object.keys(zip.files).filter((entry) => /^word\/(?:header|footer)\d+\.xml$/i.test(entry))) {
    const xml = await zip.file(name).async("string");
    zip.file(name, replaceScalarTokens(xml, data.scalars).replace(/<w:fldChar\b(?![^>]*w:dirty=)([^>]*)w:fldCharType="begin"/g, '<w:fldChar w:dirty="true"$1w:fldCharType="begin"'));
  }
  const settingsEntry = zip.file("word/settings.xml");
  if (settingsEntry) {
    let settings = await settingsEntry.async("string");
    if (!/<w:updateFields\b/.test(settings)) settings = settings.replace(/<\/w:settings>/, '<w:updateFields w:val="true"/></w:settings>');
    zip.file("word/settings.xml", settings);
  }
  const unresolved = [...documentXml.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]);
  if (unresolved.length) throw new Error(`ULA master template contains unresolved fields: ${unique(unresolved).join(", ")}`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
