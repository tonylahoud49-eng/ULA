import { computeFileHash } from "./dossierStore.mjs";
import { createConfiguredProvider } from "../provider.mjs";

const READER_SYSTEM_PROMPT = `You are the Perceptual Document Reader sub-agent for United Loss Adjusters.
Index the document and output ONLY valid JSON matching this schema:
{
  "document_type": "Commercial Invoice" | "Bill of Lading" | "Survey Report" | "Policy" | "Temperature Records" | "Packing List" | "Other",
  "document_date": "YYYY-MM-DD" or null,
  "reference_numbers": { "invoice_number": null, "bl_number": null, "container_number": null, "seal_number": null },
  "parties": { "shipper": null, "consignee": null, "carrier": null, "insured": null },
  "line_items": [{ "description": "", "quantity": 0, "unit_price": 0, "total": 0 }],
  "salient_facts": []
}`;

export async function indexDocumentWithReader({
  file,
  cachedDoc = null,
  claimContext = {},
  providerName = "gemini",
  modelName = process.env.GEMINI_MODEL || "gemini-3.7-flash",
}) {
  const currentHash = computeFileHash(file.buffer);

  // If dossier already contains identical file hash, bypass LLM completely ($0.00 cost)
  if (cachedDoc && cachedDoc.hash === currentHash && cachedDoc.extracted_fields) {
    return {
      from_cache: true,
      hash: currentHash,
      name: file.originalname,
      document_type: cachedDoc.document_type || "Supporting Evidence",
      extracted_fields: cachedDoc.extracted_fields,
      line_items: cachedDoc.line_items || [],
      salient_facts: cachedDoc.salient_facts || [],
    };
  }

  let provider = null;
  try {
    const configured = createConfiguredProvider({ providerName, modelName });
    provider = configured?.provider;
  } catch {
    provider = null;
  }

  if (!provider) {
    // Graceful offline/mock fallback for tests or when API key is missing
    const textSnippet = file.buffer.toString("utf8").slice(0, 1000);
    const isInvoice = /invoice/i.test(file.originalname) || /invoice/i.test(textSnippet);
    const isBL = /bill of lading|b\/l/i.test(file.originalname) || /bill of lading/i.test(textSnippet);
    const isSurvey = /survey/i.test(file.originalname) || /survey/i.test(textSnippet);

    const docType = isInvoice ? "Commercial Invoice" : isBL ? "Bill of Lading" : isSurvey ? "Survey Report" : "Supporting Evidence";
    return {
      from_cache: false,
      hash: currentHash,
      name: file.originalname,
      document_type: docType,
      extracted_fields: { source_snippet: textSnippet.slice(0, 200) },
      line_items: [],
      salient_facts: [`Ingested without live LLM provider (${file.originalname})`],
    };
  }

  const prompt = `${READER_SYSTEM_PROMPT}\n\nDocument Filename: ${file.originalname}\nClaim Business Line: ${claimContext.business_line || "Marine Cargo"}`;
  const res = await provider.analyze({
    claim: { title: `Index: ${file.originalname}`, prompt, ...claimContext },
    evidence: [{
      document_id: file.originalname,
      document_name: file.originalname,
      kind: "text",
      pages: [{ page: 1, text: file.buffer.toString("utf8").slice(0, 20000) }],
      mime_type: file.mimetype || "text/plain",
      extraction_status: "extracted",
    }],
    files: [file],
    styleReferences: [],
  });

  const parsed = res?.analysis || {};
  return {
    from_cache: false,
    hash: currentHash,
    name: file.originalname,
    document_type: parsed.document_types?.[0]?.document_type || "Supporting Evidence",
    extracted_fields: (parsed.fields || []).reduce((acc, f) => {
      acc[f.field] = f.value;
      return acc;
    }, {}),
    line_items: parsed.adjustment_line_items || [],
    salient_facts: (parsed.evidence_findings || []).map((f) => f.finding),
  };
}
