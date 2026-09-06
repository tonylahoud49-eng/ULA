const MANDATORY_DOCS_BY_LINE = {
  "Marine Cargo (Reefer/GFS)": ["Bill of Lading", "Commercial Invoice", "Survey Report", "Temperature Records"],
  "Marine Cargo (Non-Reefer)": ["Bill of Lading", "Commercial Invoice", "Survey Report"],
  "Property": ["Policy", "Incident Report", "Repair Invoice or Quotation"],
  "Air Shipment (NET)": ["Air Waybill", "Commercial Invoice", "Survey Report"],
  "Land Shipment": ["Consignment Note", "Commercial Invoice", "Survey Report"],
  "Bulk Vessel": ["Bill of Lading", "Draft Survey", "Discharge Certificate"],
  "Fidelity Claims": ["Policy", "Account Ledger", "Investigation Statement"],
};

export function reconcileDossier({ business_line = "Marine Cargo", documents = {} }) {
  const docList = Object.values(documents);
  const presentTypes = new Set(docList.map((d) => d.document_type).filter(Boolean));
  const mandatory = MANDATORY_DOCS_BY_LINE[business_line] || ["Policy", "Commercial Invoice", "Survey Report"];
  const missing = mandatory.filter((req) => !presentTypes.has(req));

  const containers = new Set();
  const seals = new Set();
  const discrepancies = [];

  for (const doc of docList) {
    const fields = doc.extracted_fields || {};
    if (fields.container_number) containers.add(String(fields.container_number).trim());
    if (fields.seal_numbers || fields.seal_number) seals.add(String(fields.seal_numbers || fields.seal_number).trim());
  }

  const containerList = [...containers].filter(Boolean);
  if (containerList.length > 1) {
    discrepancies.push(`Multiple distinct container numbers detected across documents: ${containerList.join(", ")}`);
  }

  const penalty = (missing.length * 0.2) + (discrepancies.length * 0.15);
  const score = Math.max(0, Number((1 - penalty).toFixed(2)));

  return {
    business_line,
    total_documents: docList.length,
    present_document_types: [...presentTypes],
    missing_mandatory_docs: missing,
    has_bill_of_lading: presentTypes.has("Bill of Lading"),
    has_commercial_invoice: presentTypes.has("Commercial Invoice"),
    has_survey_report: presentTypes.has("Survey Report"),
    container_numbers: containerList,
    seal_numbers: [...seals].filter(Boolean),
    discrepancies,
    reconciliation_score: score,
  };
}
