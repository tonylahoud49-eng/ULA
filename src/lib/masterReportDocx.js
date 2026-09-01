import JSZip from "jszip";

export const MASTER_TEMPLATE_NAME = "260536 - CR - Victoire - UTA - 1v1.docx";
export const UNKNOWN_REPORT_VALUE = "Not established from the reviewed evidence";

const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== "" && !/^(?:requires confirmation|unknown|not established(?: from (?:the )?reviewed evidence)?|null|undefined)$/i.test(String(value).trim());
const unique = (items) => [...new Set(items.filter(Boolean))];
const numberValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!isPresent(value)) return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : null;
};
const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
const valueOrUnknown = (value) => isPresent(value) ? cleanText(value) : UNKNOWN_REPORT_VALUE;
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
    const prototype = cleanPrototype(paragraph);
    const resolved = items.length ? items : [UNKNOWN_REPORT_VALUE];
    return resolved.map((value) => replaceBlockText(prototype, value)).join("");
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

function cleanMsEntity(name, fallback = UNKNOWN_REPORT_VALUE) {
  if (!isPresent(name)) return fallback;
  const cleaned = cleanText(name);
  if (/^(?:a\)\s*)?(?:the\s+)?reinsurer\s+shall\s+be\s+liable/i.test(cleaned)) return fallback;
  if (/^m\/s\.?\s*/i.test(cleaned)) {
    return `M/s. ${cleaned.replace(/^m\/s\.?\s*/i, "").trim()}`;
  }
  return `M/s. ${cleaned}`;
}

const fact = (record, name) => record?.facts?.[name] || { value: null, sources: [] };
const factValue = (record, name) => valueOrUnknown(fact(record, name).value);
const factWithSource = (record, name) => `${factValue(record, name)}${sourceLabel(fact(record, name).sources)}`;
const amount = (value, currency) => {
  const number = numberValue(value);
  return number === null ? UNKNOWN_REPORT_VALUE : `${currency || ""} ${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};

function evidenceUnit(record, name) {
  const text = (fact(record, name).sources || []).map((source) => source.supporting_text || "").join(" ");
  return text.match(/\b(cartons?|boxes?|packages?|crates?|units?|pieces?)\b/i)?.[1] || "units";
}

function chronologySentences(record) {
  const events = record?.chronology || [];
  if (!events.length) return [];
  return events.map((event, idx) => {
    const label = cleanText(event.label);
    const datePrefix = event.date ? `${event.date}: ` : "";
    return `[${idx + 1}]. ${datePrefix}${label}${sourceLabel(event.sources)}`;
  });
}

function findingSentences(record) {
  return (record?.evidence_findings || []).map((item) => `${cleanText(item.finding)}${sourceLabel(item.sources)}`);
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
  if (isPresent(terms)) paragraphs.push(`The policy evidence records the following relevant terms and conditions: ${cleanText(terms)}${sourceLabel([...(fact(record, "warranties_conditions").sources || []), ...(fact(record, "policy_terms").sources || [])])}`);
  for (const entry of record?.policy_analysis?.entries || []) paragraphs.push(`${entry.topic}: ${entry.assessment}${sourceLabel(entry.sources)}`);
  if (!paragraphs.length) paragraphs.push("The available evidence does not contain substantive policy wording sufficient for a warranties or conditions assessment.");
  paragraphs.push("No breach, exclusion, coverage, or liability conclusion is made unless it is directly supported by the cited policy wording and claim evidence.");
  return paragraphs;
}

function conclusionParagraphs(record) {
  const financials = record?.financials || {};
  const items = [];
  if (numberValue(financials.concluded_indemnity) !== null && financials.arithmetic_valid) items.push(`The evidence-supported adjustment reconciles arithmetically to ${amount(financials.concluded_indemnity, financials.currency)}.`);
  else if (numberValue(financials.concluded_indemnity) !== null) items.push(`The evidence states a concluded amount of ${amount(financials.concluded_indemnity, financials.currency)}, but the available components do not fully reproduce it; the amount requires professional reconciliation.`);
  else if (numberValue(financials.provisional_indemnity) !== null) items.push(`The supported arithmetic produces a provisional amount of ${amount(financials.provisional_indemnity, financials.currency)} after the evidenced valuation uplift and deductions. This is not a concluded indemnity; remaining adjustment inputs and coverage require professional confirmation.`);
  else items.push("The evidence does not establish every component required to calculate a concluded indemnity without assumptions.");
  if (record?.cause_assessment?.explicit_cause) items.push(`The evidence-stated cause is ${cleanText(record.cause_assessment.explicit_cause.value)}. No broader proximate-cause conclusion is inferred.${sourceLabel(record.cause_assessment.explicit_cause.sources)}`);
  else items.push(`${record?.cause_assessment?.evidence_gap || "A definitive proximate cause is not established by the available evidence."}${sourceLabel(record?.cause_assessment?.inference_sources || [])}`);
  if (record?.policy_analysis?.has_wording) items.push(`${record.policy_analysis.entries.length} relevant policy topic(s) were identified and linked to the evidence; their legal effect, compliance, and coverage response remain subject to professional review.`);
  for (const conflict of record?.conflicts || []) items.push(`Human review required: ${conflict.message}`);
  return items;
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
  const chronology = chronologySentences(record);
  const findings = findingSentences(record);
  const validationFindings = (record.validation_checks || []).map((check) => `${check.statement}${sourceLabel(check.sources)}`);
  const conclusions = conclusionParagraphs(record);
  const documentRegister = record.document_register || [];
  const receivedDocuments = documentRegister.map((document) => `${document.document_name} - ${document.categories?.join(", ") || "document type not established"}`);
  const appendices = (record.appendices || []).map((document, index) => ({
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
    `Deductible / Excess: ${isPresent(fact(record, "deductible").value) ? cleanText(fact(record, "deductible").value) : amount(financials.deductible, currency)}`,
  ].filter(Boolean).join("\n");
  const cargoParts = [fact(record, "container_numbers").value, fact(record, "quantity").value, commodity, fact(record, "gross_weight").value].filter(isPresent);
  const arrivalParts = [fact(record, "discharge_date").value && `Discharged ${fact(record, "discharge_date").value}`, fact(record, "arrival_date").value && `Arrived ${fact(record, "arrival_date").value}`, fact(record, "delivery_date").value && `Delivered ${fact(record, "delivery_date").value}`].filter(Boolean);
  const causeSection = record.cause_assessment?.explicit_cause
    ? [`The evidence records the cause as ${cleanText(record.cause_assessment.explicit_cause.value)}.${sourceLabel(record.cause_assessment.explicit_cause.sources)}`, "No broader proximate-cause or liability conclusion is inferred beyond the cited evidence."]
    : [`${record.cause_assessment?.evidence_gap || "The available evidence records loss condition but does not establish a definitive proximate cause."}${sourceLabel(record.cause_assessment?.inference_sources || [])}`];
  const adequacy = financials.insured_value !== null && financials.invoice_value !== null
    ? `The documented insured value / limit is ${amount(financials.insured_value, currency)} and the documented invoice value is ${amount(financials.invoice_value, currency)}. The difference is ${amount(financials.insured_value - financials.invoice_value, currency)}; the invoice represents ${(financials.invoice_value / financials.insured_value * 100).toFixed(2)}% of the insured value / limit. The applicable valuation basis remains subject to policy review.`
    : "The available evidence does not establish both a comparable insured value and invoice value; no underinsurance conclusion is made.";
  
  const applicantDisplay = cleanMsEntity(applicant, "Applicant");
  const insuredDisplay = cleanMsEntity(insured, "Assured");
  const subjectDisplay = cleanText(claim.title || fact(record, "cause_of_loss").value || commodity || "Cargo Claim Assessment");
  const isNoClaim = financials.concluded_indemnity === 0 || /no[ -]?claim|sound condition|without damage/i.test(String(report.notes || claim.cause_of_loss || ""));
  const defaultRevisionReason = isNoClaim ? "Issued – Final report – No claim" : "Issued – Preliminary report – Pending repair/replacement";

  const summaryIntro = `At the request of ${applicantDisplay} (the Applicant), ULA was requested to investigate a ${valueOrUnknown(record.business_line || report.business_line || claim.business_line)} claim for ${insuredDisplay} (the Assured), establish the evidence-supported circumstances and extent of loss, and validate the claim presented under the policy. The insured interest is ${valueOrUnknown(commodity)}. Table 1 summarises the salient claim details.`;
  const noteIntro = `${summaryIntro} The following report and adjustment note is based on all uploaded evidence listed in the enclosure section. No historical template fact has been used as claim evidence.`;
  const invoiceComponents = [
    financials.fob_value !== null ? `FOB ${amount(financials.fob_value, currency)}` : null,
    financials.freight_amount !== null ? `freight ${amount(financials.freight_amount, currency)}` : null,
    financials.insurance_amount !== null ? `insurance ${amount(financials.insurance_amount, currency)}` : null,
  ].filter(Boolean);
  const valuationNarrative = financials.invoice_value !== null
    ? `Commercial invoice ${valueOrUnknown(fact(record, "invoice_number").value)} records ${invoiceComponents.length ? `${invoiceComponents.join(", ")}, and ` : ""}a total value of ${amount(financials.invoice_value, currency)}. These source valuations are not substituted for an absent presented claim.`
    : "The available evidence does not establish a commercial-invoice value suitable for reproduction in the adjustment.";
  const presentedClaimNarrative = financials.presented_claim !== null
    ? `The evidence presents a gross claim of ${amount(financials.presented_claim, currency)}${sourceLabel([...(fact(record, "claim_amount").sources || []), ...(fact(record, "gross_claim_amount").sources || [])])}.`
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

  return {
    scalars: {
      cover_title: `${applicantDisplay} – ${insuredDisplay} – ${subjectDisplay}`,
      claim_number: valueOrUnknown(report.claim_number || claim.claim_number),
      version_number: valueOrUnknown(report.version_number || 1),
      insurer: applicantDisplay,
      actual_insurer: cleanMsEntity(insurer, UNKNOWN_REPORT_VALUE),
      insured_name: insuredDisplay,
      policy_number: valueOrUnknown(policyNumber),
      issue_date: resolvedIssueDate,
      issue_year: String(new Date(report.approved_date || report.created_date || Date.now()).getFullYear()),
      preparer_name: assignmentOrUnassigned(assignments.preparer?.name || report.preparer_name || claim.prepared_by),
      reviewer_name: assignmentOrUnassigned(assignments.reviewer?.name || report.reviewer_name || claim.reviewed_by),
      approver_name: assignmentOrUnassigned(assignments.approver?.name || report.approver_name || claim.approved_by),
      preparer_designation: assignmentOrUnassigned(assignments.preparer?.designation || report.preparer_designation),
      reviewer_designation: assignmentOrUnassigned(assignments.reviewer?.designation || report.reviewer_designation),
      approver_designation: assignmentOrUnassigned(assignments.approver?.designation || report.approver_designation),
      revision_reason: isPresent(report.notes) && report.notes !== "Initial controlled draft" ? report.notes : defaultRevisionReason,
      summary_assured: insuredDisplay,
      summary_consignee: cleanMsEntity(consignee, UNKNOWN_REPORT_VALUE),
      summary_policy: policyDetails,
      policy_details: policyDetails,
      incoterm: factWithSource(record, "incoterm"),
      transport_document: `${transportLabel}: ${valueOrUnknown(transportReference)}${sourceLabel([...(fact(record, "bill_of_lading").sources || []), ...(fact(record, "air_waybill").sources || [])])}`,
      shipper: cleanMsEntity(fact(record, "shipper").value, UNKNOWN_REPORT_VALUE),
      consignee: cleanMsEntity(consignee, UNKNOWN_REPORT_VALUE),
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
      report_summary_intro: [summaryIntro],
      report_summary_findings: unique([...chronology.slice(0, 4), ...findings.slice(0, 5), ...validationFindings.slice(0, 3)]),
      report_summary_opinion: conclusions,
      document_sighting: [`We confirm review of the ${documentRegister.length} uploaded document(s) listed in "Enclosure to this report". Receipt of a file is not treated as proof that every substantive document requirement is complete.`],
      report_note_intro: [noteIntro],
      interest_insured: [`${valueOrUnknown(commodity)} was documented for transit from ${valueOrUnknown(from)} to ${valueOrUnknown(to)} under Policy No. ${valueOrUnknown(policyNumber)}.${sourceLabel([...(fact(record, "commodity").sources || []), ...(fact(record, "policy_number").sources || [])])}`],
      surveyor_notes: unique([...chronology, ...findings, ...validationFindings]),
      cause_of_loss_section: causeSection,
      policy_conditions_section: policyParagraphs(record),
      adequacy_section: [adequacy],
      assessors_section: [isPresent(fact(record, "surveyor").value) ? `The evidence identifies ${factWithSource(record, "surveyor")} as surveyor / assessor.` : "The available evidence does not identify an assessor appointed on behalf of the Assured."],
      adjustment_intro: [
        `${presentedClaimNarrative} Source valuations are not substituted for an absent claim quantum, and unknown deductions are not treated as zero.`,
        adjustedClaimNarrative,
        valuationUpliftNarrative,
        valuationNarrative,
        freightInvoiceNarrative,
      ].filter(Boolean),
      conclusion_items: conclusions,
      enclosure_items: receivedDocuments,
      outstanding_items: record.outstanding_documents || [],
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
    return `${pageHeading}${matchingImages.map((item) => replaceBlockText(imagePrototype.replaceAll("rId20", item.relationship_id), "")).join("")}`;
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
  documentXml = replaceDynamicTableRows(documentXml, "damage_description", data.damage_rows, ["damage_description", "damage_quantity", "damage_packing"]);
  documentXml = replaceDynamicTableRows(documentXml, "adjustment_description", data.adjustment_rows, ["adjustment_description", "adjustment_quantity", "adjustment_unit_price", "adjustment_value"]);
  documentXml = replaceAppendixArea(documentXml, data.appendices, resolvedImages);
  documentXml = replaceScalarTokens(documentXml, data.scalars);
  documentXml = documentXml.replace(/<w:highlight\s+w:val="yellow"\s*\/>/g, "");
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
