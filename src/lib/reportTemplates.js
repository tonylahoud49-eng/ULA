export const REPORT_WORKFLOW_ROLES = [
  {
    id: "investigator",
    label: "Investigator / Attendee",
    sampleLabels: ["Inspected by", "Attended by", "Investigated by"],
    designations: ["Correspondent Surveyor", "Marine Surveyor", "Technical Specialist"],
    permissions: ["view_assigned_claim", "upload_evidence", "record_findings", "submit_investigation"],
  },
  {
    id: "preparer",
    label: "Preparer / Writer",
    sampleLabels: ["Prepared by", "Written by"],
    designations: ["Claims Administrator", "Claims Handler", "Liability Claims Manager", "Claims Director"],
    permissions: ["edit_claim_facts", "draft_report", "edit_adjustment", "submit_for_review"],
  },
  {
    id: "reviewer",
    label: "Reviewer",
    sampleLabels: ["Reviewed by", "Prepared & reviewed by"],
    designations: ["Claims Director", "Chartered Engineer", "Average Adjuster", "Loss Adjuster"],
    permissions: ["review_report", "comment", "request_changes", "complete_review"],
  },
  {
    id: "approver",
    label: "Approver",
    sampleLabels: ["Approved by", "Reviewed & approved by"],
    designations: ["Director", "Chartered Engineer", "Average Adjuster", "Loss Adjuster"],
    permissions: ["approve_report", "sign_report", "issue_final", "create_revision"],
  },
];

export const REPORT_LIFECYCLE = [
  { id: "evidence", label: "Evidence", description: "Source documents and field material are registered." },
  { id: "analysis", label: "Analysis", description: "Facts are extracted, classified, and linked to evidence." },
  { id: "adjustment", label: "Adjustment", description: "Claimed, covered, deducted, and adjusted values are reviewed." },
  { id: "review", label: "Review", description: "A professional reviewer checks the complete draft." },
  { id: "approval", label: "Approval", description: "An authorized approver signs and issues a controlled version." },
];

export const COMMON_REPORT_SECTIONS = [
  { id: "cover", title: "Cover Page", owner: "preparer", required: true },
  { id: "document_control", title: "Document Control", owner: "preparer", required: true },
  { id: "version_history", title: "Version History", owner: "preparer", required: true },
  { id: "executive_summary", title: "Report Summary", owner: "preparer", required: true },
  { id: "claim_facts", title: "Claim Salient Details", owner: "preparer", required: true },
  { id: "appointment", title: "Appointment and Scope", owner: "preparer", required: true },
  { id: "investigation", title: "Investigation and Findings", owner: "investigator", required: true },
  { id: "cause", title: "Cause of Loss", owner: "reviewer", required: true, humanApproval: true },
  { id: "coverage", title: "Policy and Coverage Analysis", owner: "reviewer", required: true, humanApproval: true },
  { id: "adjustment", title: "Claim and Adjustment", owner: "preparer", required: true, humanApproval: true },
  { id: "conclusion", title: "Conclusion", owner: "approver", required: true, humanApproval: true },
  { id: "supporting_documents", title: "Supporting Documents", owner: "preparer", required: true },
  { id: "outstanding_documents", title: "Outstanding Documents", owner: "preparer", required: true },
  { id: "appendices", title: "Appendices and Photographs", owner: "investigator", required: false },
  { id: "corporate", title: "About ULA and Strategic Alliances", owner: "preparer", required: true },
];

const COMMON_FIELDS = [
  "claim_number",
  "title",
  "business_line",
  "insured",
  "insurer",
  "broker",
  "policy_number",
  "date_of_loss",
  "date_of_intimation",
  "country",
  "claim_amount",
  "deductible",
  "cause_of_loss",
];

const COMMON_DOCUMENTS = ["Policy", "Claim Form", "Supporting Evidence"];

const unique = (items) => [...new Set(items)];

const ULA_MASTER_REPORT_SECTIONS = [
  { id: "cover", title: "Cover Page", owner: "preparer", required: true },
  { id: "document_control", title: "Document Control Page", owner: "preparer", required: true },
  { id: "executive_summary", title: "Report Summary", owner: "preparer", required: true },
  { id: "claim_facts", title: "Report and adjustment note", owner: "preparer", required: true },
  { id: "interest_insured", title: "INTEREST INSURED & RELEVANT CONDITIONS OF INSURANCE POLICY", owner: "preparer", required: true },
  { id: "surveyor_notes", title: "SURVEYOR NOTES", owner: "investigator", required: true },
  { id: "cause", title: "CAUSE OF LOSS", owner: "reviewer", required: true, humanApproval: true },
  { id: "warranties", title: "RELEVANT POLICY WARRANTIES & CONDITIONS", owner: "reviewer", required: true, humanApproval: true },
  { id: "insured_value", title: "ADEQUACY OF THE INSURED VALUE", owner: "reviewer", required: true },
  { id: "assessors", title: "APPOINTMENT OF ASSESSORS", owner: "preparer", required: false },
  { id: "adjustment", title: "CLAIM PRESENTED ON THE POLICY & ADJUSTMENT", owner: "preparer", required: true, humanApproval: true },
  { id: "conclusion", title: "CONCLUSION", owner: "approver", required: true, humanApproval: true },
  { id: "supporting_documents", title: "Enclosure to this report", owner: "preparer", required: true },
  { id: "outstanding_documents", title: "Outstanding/ Not Available Documents", owner: "preparer", required: true },
  { id: "appendices", title: "Appendices", owner: "investigator", required: false },
  { id: "corporate", title: "About ULA", owner: "preparer", required: true },
];

const template = (id, name, requiredFields, requiredDocuments, _sections, fields = []) => ({
  id,
  name,
  requiredFields: [...COMMON_FIELDS, ...requiredFields],
  requiredDocuments: unique([...COMMON_DOCUMENTS, ...requiredDocuments]),
  sections: ULA_MASTER_REPORT_SECTIONS,
  fields,
});

export const REPORT_TEMPLATES = {
  "Air Shipment (NET)": {
    id: "air-shipment",
    name: "Air Shipment Report",
    requiredFields: unique([...COMMON_FIELDS, "shipper", "consignee", "carrier", "air_waybill", "voyage_from", "voyage_to", "commodity"]),
    requiredDocuments: unique([...COMMON_DOCUMENTS, "Air Waybill", "Commercial Invoice", "Packing List", "Survey Evidence"]),
    sections: ULA_MASTER_REPORT_SECTIONS,
    fields: [],
  },
  "Marine Cargo (Reefer/GFS)": template(
    "marine-reefer",
    "Marine Reefer Cargo Report",
    ["shipper", "consignee", "bill_of_lading", "commodity", "vessel_name", "port_of_loading", "port_of_discharge"],
    ["Policy", "Bill of Lading", "Commercial Invoice", "Packing List", "Temperature Records", "Survey Evidence"],
    [
      { id: "routing", title: "Shipment Routing", owner: "preparer", required: true },
      { id: "temperature", title: "Temperature and Cold-Chain Review", owner: "investigator", required: true },
      { id: "notice", title: "Notice of Claim", owner: "preparer", required: true },
      { id: "weather", title: "Weather and Voyage Conditions", owner: "investigator", required: false },
      { id: "timing", title: "Timing of Damage", owner: "reviewer", required: true },
    ],
  ),
  "Marine Cargo (Non-Reefer)": template(
    "marine-non-reefer",
    "Marine Non-Reefer Cargo Report",
    ["shipper", "consignee", "bill_of_lading", "commodity", "vessel_name", "port_of_loading", "port_of_discharge"],
    ["Policy", "Bill of Lading", "Commercial Invoice", "Packing List", "Notice of Claim", "Survey Evidence"],
    [
      { id: "routing", title: "Shipment Routing", owner: "preparer", required: true },
      { id: "surveyor_notes", title: "Surveyor Notes and Findings", owner: "investigator", required: true },
      { id: "notice", title: "Notice of Claim", owner: "preparer", required: true },
      { id: "weather", title: "Past Weather and Voyage Conditions", owner: "investigator", required: false },
      { id: "timing", title: "Timing of Damage", owner: "reviewer", required: true },
    ],
  ),
  "Bulk Vessel": template(
    "bulk-vessel",
    "Bulk Vessel Cargo Report",
    ["shipper", "consignee", "bill_of_lading", "commodity", "vessel_name", "port_of_loading", "port_of_discharge"],
    ["Policy", "Bill of Lading", "Commercial Invoice", "Cargo Certificates", "Joint Survey Records", "Survey Evidence"],
    [
      { id: "survey_timeline", title: "Survey Timeline and Attendance", owner: "investigator", required: true },
      { id: "routing", title: "Shipment Routing", owner: "preparer", required: true },
      { id: "notices", title: "Notices, Letters and Reservations", owner: "preparer", required: true },
      { id: "certificates", title: "Cargo Certificates and Sales Contract", owner: "reviewer", required: true },
      { id: "recovery", title: "Recovery, Merits and Salvage", owner: "reviewer", required: false },
    ],
  ),
  Property: template(
    "property",
    "Property Report",
    ["premises", "occupancy", "incident_summary"],
    ["Policy", "Fire or Incident Report", "Invoices and Quotations", "Photographs", "Survey Evidence"],
    [
      { id: "premises", title: "Business and Premises", owner: "preparer", required: true },
      { id: "loss_history", title: "Loss History and Discovery", owner: "investigator", required: true },
      { id: "damage_extent", title: "Extent of Damage", owner: "investigator", required: true },
      { id: "fire_investigation", title: "Fire or Incident Investigation", owner: "reviewer", required: true },
      { id: "protections", title: "Fire Protections and Risk Controls", owner: "investigator", required: false },
      { id: "sums_insured", title: "Adequacy of Sums Insured", owner: "reviewer", required: true },
    ],
  ),
  "Fidelity Claims": template(
    "fidelity",
    "Fidelity Report",
    ["employee_name", "incident_summary", "coverage_period"],
    ["Policy", "Employee Records", "Account Ledger", "Invoices", "Investigation Statements"],
    [
      { id: "employee", title: "Employee and Loss Particulars", owner: "preparer", required: true },
      { id: "investigations", title: "Investigations and Interviews", owner: "investigator", required: true },
      { id: "ledger", title: "Client, Invoice and Ledger Review", owner: "preparer", required: true },
      { id: "special_clauses", title: "Special Clauses and Accounts Warranty", owner: "reviewer", required: true },
    ],
  ),
  Yacht: template(
    "yacht",
    "Yacht Report",
    ["yacht_name", "home_port", "registration", "engines"],
    ["Policy", "Registration", "Repair Quotations", "Survey Evidence", "Photographs"],
    [
      { id: "interest_insured", title: "Interest and Policy", owner: "preparer", required: true },
      { id: "yacht_particulars", title: "Yacht Particulars", owner: "investigator", required: true },
      { id: "circumstances", title: "Circumstances and Attendance", owner: "investigator", required: true },
      { id: "repair_schedule", title: "Repair Schedule", owner: "preparer", required: true },
      { id: "jurisdiction", title: "Jurisdiction and Practice", owner: "reviewer", required: false },
    ],
  ),
  "Land Shipment": template(
    "land-shipment",
    "Land Shipment Report",
    ["shipper", "consignee", "incoterm", "truck_waybill", "vehicle_details", "commodity"],
    ["Policy", "Truck Waybill", "Commercial Invoice", "Packing List", "Survey Evidence"],
    [
      { id: "interest_insured", title: "Interest Insured and Conditions", owner: "preparer", required: true },
      { id: "transport", title: "Road Transport Particulars", owner: "investigator", required: true },
      { id: "driver_vehicle", title: "Driver and Vehicle Details", owner: "investigator", required: true },
    ],
  ),
};

export const FALLBACK_REPORT_TEMPLATE = template(
  "general-claim",
  "General Claim Report",
  [],
  ["Policy", "Claim Form", "Supporting Evidence"],
  [],
);

export const REQUIRES_REVIEW_REPORT_TEMPLATE = template(
  "requires-review",
  "Report Template Requires Review",
  [],
  ["Policy", "Claim Form", "Supporting Evidence"],
  [],
);

export function getReportTemplate(businessLine) {
  if (businessLine === "Requires Review" || businessLine === "Other / Requires Review") {
    return REQUIRES_REVIEW_REPORT_TEMPLATE;
  }
  return REPORT_TEMPLATES[businessLine] || FALLBACK_REPORT_TEMPLATE;
}

export function reportAssignments(claim = {}, generatedBy = "") {
  return [
    { role: "investigator", label: "Investigated / attended by", name: claim.surveyor || "To be assigned", designation: claim.surveyor_designation || "Surveyor / Technical Specialist" },
    { role: "preparer", label: "Prepared / written by", name: claim.prepared_by || generatedBy || "To be assigned", designation: claim.preparer_designation || "Claims Handler" },
    { role: "reviewer", label: "Reviewed by", name: claim.reviewed_by || "To be assigned", designation: claim.reviewer_designation || "Claims Director / Technical Reviewer" },
    { role: "approver", label: "Approved by", name: claim.approved_by || "To be assigned", designation: claim.approver_designation || "Director / Chartered Adjuster" },
  ];
}

export function reportReadiness(claim = {}, documents = []) {
  const resolvedBusinessLine = claim.business_line && !["Unclassified", "Requires Review"].includes(claim.business_line)
    ? claim.business_line
    : claim.ai_suggested_business_line || claim.business_line;
  const reportTemplate = getReportTemplate(resolvedBusinessLine);
  const normalizedFacts = claim.normalized_claim_record?.facts || {};
  const suggestedValues = claim.ai_analysis?.suggested_claim_data || {};
  const placeholder = /^(?:requires confirmation|to be confirmed|unknown|not (?:available|provided|stated|assigned|established(?: from (?:the )?reviewed evidence)?)|n\/?a|null|undefined|-+)\.?$/i;
  const monetaryFields = new Set(["claim_amount", "deductible", "policy_limit", "insured_value"]);
  const usable = (field, value, fact) => {
    if (value === undefined || value === null || String(value).trim() === "" || placeholder.test(String(value).trim())) return false;
    if (["business_line"].includes(field) && ["Unclassified", "Requires Review", "Other / Requires Review"].includes(String(value))) return false;
    if (monetaryFields.has(field) && Number(String(value).replace(/[^0-9.-]/g, "")) === 0) {
      return fact?.status === "supported" && (fact.sources || []).length > 0;
    }
    return true;
  };
  const readinessValue = (field) => {
    const fact = normalizedFacts[field];
    if (fact && fact.status !== "requires_confirmation" && usable(field, fact.value, fact)) return fact.value;
    if (usable(field, claim[field], fact)) return claim[field];
    return usable(field, suggestedValues[field], fact) ? suggestedValues[field] : null;
  };
  const missingFields = reportTemplate.requiredFields.filter((field) => {
    return readinessValue(field) === null;
  });
  const analyzedDocumentTypes = new Set((claim.ai_analysis?.document_types || [])
    .filter((item) => item.sufficient_information !== false)
    .map((item) => String(item.document_type).toLowerCase()));
  const missingDocuments = reportTemplate.requiredDocuments.filter((required) => {
    const requiredValue = required.toLowerCase();
    const aliases = requiredValue === "survey evidence"
      ? ["survey evidence", "survey report"]
      : requiredValue === "supporting evidence"
        ? ["supporting evidence", "survey report", "commercial invoice", "photographs", "incident report"]
        : [requiredValue];
    if ([...analyzedDocumentTypes].some((category) => aliases.some((alias) =>
      category === alias || category.includes(alias) || alias.includes(category)))) return false;
    return !documents.some((document) => {
      const detectionEvidence = Array.isArray(document.detected_category_evidence)
        ? document.detected_category_evidence
        : [];
      const contentCategories = (Array.isArray(document.detected_categories) ? document.detected_categories : [])
        .filter((category) => {
          const detail = detectionEvidence.find((item) => item.category === category);
          if (!detail) return true;
          return detail.sufficient_information ?? (Number(detail.confidence ?? 1) > 0);
        })
        .map((category) => String(category).toLowerCase());

      if (document.content_analysis_basis === "ai-content" || document.content_analysis_basis === "extracted-text") {
        return contentCategories.some((category) => aliases.some((alias) =>
          category === alias || category.includes(alias) || alias.includes(category),
        ));
      }

      // Before content analysis has run, preserve the existing manually assigned
      // type/category behavior. Filenames are intentionally not treated as proof.
      const manualMetadata = [document.file_type, document.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const terms = requiredValue.split(/\s+|\//).filter((term) => term.length > 3);
      return terms.length > 0 && terms.some((term) => manualMetadata.includes(term));
    });
  });
  const completedFields = reportTemplate.requiredFields.length - missingFields.length;
  const completedDocuments = reportTemplate.requiredDocuments.length - missingDocuments.length;
  const total = reportTemplate.requiredFields.length + reportTemplate.requiredDocuments.length;
  const complete = completedFields + completedDocuments;

  return {
    template: reportTemplate,
    missingFields,
    missingDocuments,
    fieldProgress: reportTemplate.requiredFields.length ? Math.round((completedFields / reportTemplate.requiredFields.length) * 100) : 100,
    documentProgress: reportTemplate.requiredDocuments.length ? Math.round((completedDocuments / reportTemplate.requiredDocuments.length) * 100) : 100,
    overallProgress: total ? Math.round((complete / total) * 100) : 100,
  };
}
