export const BRAIN_BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims"];
export const BRAIN_TOPICS = {
  "Physical damage": ["damage", "breakage", "impact", "repair", "packing"],
  "Water damage": ["water", "wetting", "seepage", "rust", "condensation"],
  "Temperature damage": ["temperature", "reefer", "frozen", "chilled", "refrigeration"],
  "Shortage and non-delivery": ["shortage", "non-delivery", "missing", "theft"],
  "Fire and smoke": ["fire", "smoke", "ignition", "electrical"],
  "Fidelity loss": ["fidelity", "embezzlement", "employee dishonesty", "fraud"],
};
export const brainError = (message, status = 400) => Object.assign(new Error(message), { status });
export const isBrainAdmin = (actor) => actor?.role === "admin";
export const canReadBrainReport = (record, actor) => Boolean(record && actor?.id && (isBrainAdmin(actor) || record.uploaded_by === actor.id));
export const assertBrainAdmin = (actor) => { if (!isBrainAdmin(actor)) throw brainError("Administrator access is required.", 403); };
export const brainMetadata = (record) => {
  const data = { ...record };
  for (const key of ["buffer", "original_base64", "extracted_text"]) delete data[key];
  return data;
};

export function finalReportSubmission(body = {}) {
  if (body.report_status !== "final" || body.approved_confirmation !== "true") throw brainError("Only an already approved final report can be submitted. Draft, unapproved, and rejected reports are not accepted.");
  const fields = {};
  for (const key of ["claim_case_id", "report_title", "approved_by", "approval_date"]) {
    fields[key] = String(body[key] || "").trim();
    if (!fields[key] || fields[key].length > 200) throw brainError("Enter the case reference, report title, approving professional, and approval date (maximum 200 characters each).");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.approval_date) || !Number.isFinite(Date.parse(fields.approval_date)) || new Date(fields.approval_date).toISOString().slice(0, 10) !== fields.approval_date) throw brainError("Enter a valid approval date.");
  if (!BRAIN_BUSINESS_LINES.includes(body.business_line) || !Object.hasOwn(BRAIN_TOPICS, body.topic)) throw brainError("Select a supported business line and loss topic.");
  return { ...fields, business_line: body.business_line, topic: body.topic, report_status: "final", approval_status: "submitted" };
}

export function approvedBrainManifest(record, notes, confirmation) {
  if (record.approval_status !== "verified" || !record.verified_by || !record.verified_at || !record.learned_at || !record.style_notes?.length) throw brainError("Verify the final report's approval and digest it before approving methodology.", 409);
  if (!confirmation) throw brainError("Confirm that these suggestions contain only reusable methodology, comply with the report specification, and can be shared with ULA staff.");
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 20 || notes.some((note) => typeof note !== "string" || !note.trim() || note.length > 1500)) throw brainError("Supply 1–20 methodology notes, each up to 1,500 characters.");
  const knownIdentifiers = [record.claim_case_id, record.report_title, record.approved_by, record.file_name].filter((value) => value?.length >= 4);
  const cleaned = [...new Set(notes.map((note) => note.trim()))];
  for (const note of cleaned) {
    // Conservative activation guard. Names and context still require human review.
    if (/\d|@|https?:\/\/|\b(?:USD|EUR|GBP|LBP)\b|[$€£]/i.test(note) || knownIdentifiers.some((value) => note.toLowerCase().includes(value.toLowerCase()))) throw brainError("Remove names, case identifiers, numbers, dates, amounts, contact details, and historical claim facts before activation.");
  }
  return {
    approved: true, is_brain_knowledge: true, brain_report_id: record.id,
    revision: (record.revision || 0) + 1,
    profile_id: `brain_${record.id}`, title: `Approved ${record.business_line} methodology`,
    section_order: [], style_notes: cleaned,
    applies_to: { business_lines: [record.business_line], evidence_terms_any: BRAIN_TOPICS[record.topic], client_terms: [] },
    source_role: "style_reference_only",
  };
}

const immutable = ["id", "file_name", "mime_type", "size", "file_hash", "created_at", "uploaded_by", "uploader_name", "claim_case_id", "report_title", "business_line", "topic", "report_status", "approved_by", "approval_date", "source_report_version_id", "source_claim_id"];
export function applyBrainChanges(record, changes) {
  if (!changes || typeof changes !== "object" || Object.hasOwn(changes, "original_base64") || Object.hasOwn(changes, "buffer") || immutable.some((key) => Object.hasOwn(changes, key) && changes[key] !== record[key])) throw brainError("The original approved report and its source metadata are immutable.", 409);
  return { ...record, ...changes, revision: (record.revision || 0) + 1, updated_at: new Date().toISOString() };
}
