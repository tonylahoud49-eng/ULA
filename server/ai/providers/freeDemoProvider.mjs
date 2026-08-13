import { evidenceText } from "../../evidence/extractEvidence.mjs";
import { enforceGrounding } from "./openaiProvider.mjs";

/**
 * Free Zero-Key AI Extractor Provider.
 *
 * Used when no cloud API key (Gemini, OpenRouter, OpenAI) is configured.
 * Intelligently analyzes evidence text, extracts claim facts, classifies business lines,
 * identifies document types, and generates grounded evidence citations.
 */

const BUSINESS_LINE_KEYWORDS = [
  { line: "Yacht", keywords: ["yacht", "hull", "keel", "marina", "vessel name", "boat", "yachting"] },
  { line: "Property", keywords: ["property", "building", "fire", "water damage", "facility", "premises", "warehouse"] },
  { line: "Marine Cargo (Reefer/GFS)", keywords: ["reefer", "temperature", "cold storage", "gfs", "chilled", "frozen", "container temperature"] },
  { line: "Marine Cargo (Non-Reefer)", keywords: ["cargo", "bill of lading", "container", "dry cargo", "shipment", "freight", "consignee"] },
  { line: "Bulk Vessel", keywords: ["bulk vessel", "bulk cargo", "grain", "coal", "ore", "draft survey", "hold"] },
  { line: "Air Shipment (NET)", keywords: ["air waybill", "awb", "flight", "air shipment", "airport", "net shipment"] },
  { line: "Fidelity Claims", keywords: ["fidelity", "employee theft", "fraud", "embezzlement", "misappropriation", "ledger", "accounting"] },
];

const FIELD_PATTERNS = [
  { field: "insured", regex: /(?:insured|claimant|assured|client|customer)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "insurer", regex: /(?:insurer|underwriter|insurance company)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "policy_number", regex: /(?:policy\s*(?:no|number|#)?)\s*[:\-]\s*([A-Z0-9\/-]+)/i },
  { field: "policy_limit", regex: /(?:policy limit|limit of liability|sum insured)\s*[:\-]\s*([$€£]?\s*[0-9,]+(?:\.[0-9]{2})?)/i },
  { field: "deductible", regex: /(?:deductible|excess)\s*[:\-]\s*([$€£]?\s*[0-9,]+(?:\.[0-9]{2})?)/i },
  { field: "date_of_loss", regex: /(?:date of loss|loss date|incident date|event date)\s*[:\-]\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i },
  { field: "cause_of_loss", regex: /(?:cause of loss|loss cause|reason for claim|incident details|circumstances)\s*[:\-]\s*([^\n\r;\.]+)/i },
  { field: "claim_amount", regex: /(?:claimed amount|claim amount|amount claimed|total claimed)\s*[:\-]\s*([$€£]?\s*[0-9,]+(?:\.[0-9]{2})?)/i },
  { field: "adjusted_amount", regex: /(?:adjusted amount|recommended payment|settlement amount)\s*[:\-]\s*([$€£]?\s*[0-9,]+(?:\.[0-9]{2})?)/i },
  { field: "vessel_name", regex: /(?:vessel|vessel name|ship|craft)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "container_number", regex: /(?:container\s*(?:no|number|#)?)\s*[:\-]\s*([A-Z]{4}[0-9]{7}|[A-Z0-9\/-]{7,15})/i },
  { field: "port_of_loading", regex: /(?:port of loading|pol|loading port)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "port_of_discharge", regex: /(?:port of discharge|pod|discharge port)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "commodity", regex: /(?:commodity|goods|cargo description|description of goods)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "shipper", regex: /(?:shipper|consignor|exporter)\s*[:\-]\s*([^\n\r,;\.]+)/i },
  { field: "consignee", regex: /(?:consignee|importer|receiver)\s*[:\-]\s*([^\n\r,;\.]+)/i },
];

const DOC_TYPE_KEYWORDS = [
  { type: "Policy", keywords: ["policy", "certificate of insurance", "schedule of insurance", "underwriting"] },
  { type: "Claim Form", keywords: ["claim form", "statement of claim", "notice of loss", "claim notification"] },
  { type: "Survey Report", keywords: ["survey report", "inspection report", "loss report", "surveyor notes"] },
  { type: "Commercial Invoice", keywords: ["commercial invoice", "tax invoice", "invoice no", "sale invoice"] },
  { type: "Packing List", keywords: ["packing list", "weight list", "package list"] },
  { type: "Bill of Lading", keywords: ["bill of lading", "b/l", "ocean bill of lading"] },
  { type: "Air Waybill", keywords: ["air waybill", "awb", "air consignment note"] },
  { type: "Repair Invoice or Quotation", keywords: ["repair invoice", "repair estimate", "quotation", "repair quote"] },
  { type: "Incident Report", keywords: ["incident report", "police report", "occurrence report"] },
  { type: "Registration", keywords: ["registration certificate", "vessel registration", "registry"] },
  { type: "Photographs", keywords: ["photo", "photograph", "picture", "damage photo"] },
];

export function createFreeDemoProvider() {
  return {
    name: "free-demo",
    model: "ULA Local AI Engine (Free Zero-Key)",
    async analyze({ claim, evidence }) {
      const allTextParts = [];
      const evidenceById = new Map();

      evidence.forEach((item) => {
        const text = evidenceText(item) || "";
        allTextParts.push({ item, text });
        evidenceById.set(item.document_id, item);
      });

      const combinedText = allTextParts.map(({ text }) => text).join("\n\n");
      const lowerCombined = combinedText.toLowerCase();

      // 1. Classify Business Line
      let bestLine = "Other / Requires Review";
      let maxScore = 0;
      let winningSource = null;

      for (const entry of BUSINESS_LINE_KEYWORDS) {
        let score = 0;
        let matchExcerpt = "";
        for (const kw of entry.keywords) {
          const idx = lowerCombined.indexOf(kw);
          if (idx !== -1) {
            score += 1;
            if (!matchExcerpt) {
              const start = Math.max(0, idx - 10);
              const end = Math.min(combinedText.length, idx + kw.length + 30);
              matchExcerpt = combinedText.slice(start, end).trim();
            }
          }
        }
        if (score > maxScore) {
          maxScore = score;
          bestLine = entry.line;
          const matchingPart = allTextParts.find(({ text }) => text.toLowerCase().includes(entry.keywords[0])) || allTextParts[0];
          winningSource = matchingPart ? {
            document_id: matchingPart.item.document_id,
            document_name: matchingPart.item.document_name,
            page: null,
            supporting_text: matchExcerpt || matchingPart.text.slice(0, 100).trim(),
            confidence: Math.min(0.95, 0.7 + score * 0.08),
            evidence_mode: "extracted_text",
          } : null;
        }
      }

      const classificationSources = winningSource ? [winningSource] : (allTextParts[0] && allTextParts[0].text ? [{
        document_id: allTextParts[0].item.document_id,
        document_name: allTextParts[0].item.document_name,
        page: null,
        supporting_text: allTextParts[0].text.slice(0, 120).trim(),
        confidence: 0.75,
        evidence_mode: "extracted_text",
      }] : []);

      // 2. Identify Document Types
      const documentTypes = [];
      for (const entry of DOC_TYPE_KEYWORDS) {
        const matchingPart = allTextParts.find(({ text }) => entry.keywords.some((kw) => text.toLowerCase().includes(kw)));
        if (matchingPart && matchingPart.text) {
          const kwMatch = entry.keywords.find((kw) => matchingPart.text.toLowerCase().includes(kw));
          const idx = matchingPart.text.toLowerCase().indexOf(kwMatch);
          const excerpt = matchingPart.text.slice(Math.max(0, idx - 10), Math.min(matchingPart.text.length, idx + 60)).trim();

          documentTypes.push({
            document_type: entry.type,
            confidence: 0.9,
            sufficient_information: true,
            rationale: `Substantive ${entry.type} terminology identified in ${matchingPart.item.document_name}.`,
            sources: [{
              document_id: matchingPart.item.document_id,
              document_name: matchingPart.item.document_name,
              page: null,
              supporting_text: excerpt,
              confidence: 0.9,
              evidence_mode: "extracted_text",
            }],
          });
        }
      }

      // Default to Claim Form if text is present
      if (!documentTypes.some((d) => d.document_type === "Claim Form") && allTextParts[0] && allTextParts[0].text) {
        documentTypes.push({
          document_type: "Claim Form",
          confidence: 0.85,
          sufficient_information: true,
          rationale: `Evidence set contains claim information in ${allTextParts[0].item.document_name}.`,
          sources: [{
            document_id: allTextParts[0].item.document_id,
            document_name: allTextParts[0].item.document_name,
            page: null,
            supporting_text: allTextParts[0].text.slice(0, 100).trim(),
            confidence: 0.85,
            evidence_mode: "extracted_text",
          }],
        });
      }

      // 3. Extract Fields
      const extractedFields = [];
      for (const entry of FIELD_PATTERNS) {
        let foundValue = null;
        let foundSource = null;

        for (const { item, text } of allTextParts) {
          const match = text.match(entry.regex);
          if (match && match[1]) {
            foundValue = match[1].trim();
            const start = Math.max(0, match.index - 5);
            const end = Math.min(text.length, match.index + match[0].length + 15);
            foundSource = {
              document_id: item.document_id,
              document_name: item.document_name,
              page: null,
              supporting_text: text.slice(start, end).trim(),
              confidence: 0.92,
              evidence_mode: "extracted_text",
            };
            break;
          }
        }

        // Check fallback from claim metadata
        if (!foundValue && claim && claim[entry.field]) {
          foundValue = String(claim[entry.field]);
        }

        extractedFields.push({
          field: entry.field,
          value: foundValue,
          normalized_value: foundValue,
          confidence: foundValue ? (foundSource ? 0.92 : 0.8) : 0,
          requires_confirmation: !foundValue,
          sources: foundSource ? [foundSource] : [],
        });
      }

      // 4. Formulate Summary & Findings
      const findings = [];
      if (claim.claim_number || claim.id) {
        findings.push({
          finding: `Claim reference ${claim.claim_number || claim.id} processed across ${evidence.length} evidence file(s).`,
          confidence: 0.95,
          sources: classificationSources,
        });
      }

      const summary = `Local AI analysis completed for claim ${claim.claim_number || claim.id || ""}. ` +
        `Business line classified as ${bestLine}. Recognized ${documentTypes.length} document type(s) ` +
        `with verifiable evidence citations.`;

      const parsedAnalysis = {
        classification: {
          business_line: bestLine,
          confidence: winningSource ? winningSource.confidence : 0.75,
          rationale: `Content analysis of ${evidence.length} registered document(s).`,
          sources: classificationSources,
        },
        document_types: documentTypes,
        fields: extractedFields,
        missing_documents: [],
        evidence_findings: findings,
        summary,
        warnings: [],
        human_review_required: ["Coverage analysis", "Cause of loss confirmation", "Adjustment calculation"],
      };

      return {
        provider: "free-demo",
        model: "ULA Local AI Engine (Free Zero-Key)",
        response_id: `free_demo_${Date.now()}`,
        analyzed_at: new Date().toISOString(),
        analysis: enforceGrounding(parsedAnalysis, evidence),
      };
    },
  };
}
