import { z } from "zod";

export const BUSINESS_LINES = [
  "Yacht",
  "Property",
  "Marine Cargo (Reefer/GFS)",
  "Marine Cargo (Non-Reefer)",
  "Bulk Vessel",
  "Air Shipment (NET)",
  "Fidelity Claims",
  "Other / Requires Review",
];

export const DOCUMENT_TYPES = [
  "Policy",
  "Claim Form",
  "Supporting Evidence",
  "Survey Report",
  "Photographs",
  "Commercial Invoice",
  "Repair Invoice or Quotation",
  "Packing List",
  "Bill of Lading",
  "Air Waybill",
  "Truck Waybill",
  "Temperature Records",
  "Cargo Certificate",
  "Notice of Claim",
  "Incident Report",
  "Registration",
  "Employee Records",
  "Account Ledger",
  "Investigation Statement",
  "Correspondence",
  "Other",
];

const sourceSchema = z.object({
  document_id: z.string(),
  document_name: z.string(),
  page: z.number().int().positive().nullable(),
  supporting_text: z.string(),
  confidence: z.number().min(0).max(1),
  evidence_mode: z.preprocess(
    (value) => value ?? "extracted_text",
    z.enum(["extracted_text", "document_vision", "image_vision"]),
  ),
});

const fieldSchema = z.object({
  field: z.enum([
    "insured",
    "insurer",
    "broker",
    "policy_number",
    "policy_limit",
    "deductible",
    "date_of_loss",
    "date_of_intimation",
    "cause_of_loss",
    "country",
    "currency",
    "claim_amount",
    "adjusted_amount",
    "surveyor",
    "vessel_name",
    "container_number",
    "port_of_loading",
    "port_of_discharge",
    "commodity",
    "shipper",
    "consignee",
  ]),
  value: z.string().nullable(),
  normalized_value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  requires_confirmation: z.boolean(),
  sources: z.array(sourceSchema),
});

export const claimAnalysisSchema = z.object({
  classification: z.object({
    business_line: z.enum(BUSINESS_LINES),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    sources: z.array(sourceSchema),
  }),
  document_types: z.array(z.object({
    document_type: z.enum(DOCUMENT_TYPES),
    confidence: z.number().min(0).max(1),
    sufficient_information: z.boolean(),
    rationale: z.string(),
    sources: z.array(sourceSchema),
  })),
  fields: z.array(fieldSchema),
  missing_documents: z.array(z.object({
    document_type: z.enum(DOCUMENT_TYPES),
    reason: z.string(),
    missing_information: z.array(z.string()),
  })),
  evidence_findings: z.array(z.object({
    finding: z.string(),
    confidence: z.number().min(0).max(1),
    sources: z.array(sourceSchema),
  })),
  summary: z.string(),
  warnings: z.array(z.string()),
  human_review_required: z.array(z.string()),
});

export const sourceSchemaForTests = sourceSchema;
