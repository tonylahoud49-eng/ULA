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

const template = (id, name, requiredFields, requiredDocuments, sections, fields = []) => ({
  id,
  name,
  requiredFields: [...COMMON_FIELDS, ...requiredFields],
  requiredDocuments,
  sections: [
    ...COMMON_REPORT_SECTIONS.slice(0, 7),
    ...sections,
    ...COMMON_REPORT_SECTIONS.slice(7),
  ],
  fields,
});

export const REPORT_TEMPLATES = {
  "Air Shipment (NET)": template(
    "air-shipment",
    "Air Shipment Report",
    ["shipper", "consignee", "carrier", "air_waybill", "voyage_from", "voyage_to", "commodity"],
    ["Policy", "Air Waybill", "Commercial Invoice", "Packing List", "Survey Evidence"],
    [
      { id: "interest_insured", title: "Interest Insured", owner: "preparer", required: true },
      { id: "warranties", title: "Warranties, Conditions and Insurable Interest", owner: "reviewer", required: true },
      { id: "assessors", title: "Appointment of Assessors", owner: "preparer", required: false },
      { id: "insured_value", title: "Adequacy of Insured Value", owner: "reviewer", required: true },
    ],
  ),
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

export function getReportTemplate(businessLine) {
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
  const reportTemplate = getReportTemplate(claim.business_line);
  const missingFields = reportTemplate.requiredFields.filter((field) => {
    const value = claim[field];
    return value === undefined || value === null || value === "";
  });
  const searchableDocuments = documents
    .flatMap((document) => [document.file_name, document.file_type, document.category])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const missingDocuments = reportTemplate.requiredDocuments.filter((required) => {
    const terms = required.toLowerCase().split(/\s+|\//).filter((term) => term.length > 3);
    return terms.length && !terms.some((term) => searchableDocuments.includes(term));
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
