import { evidenceForDraft } from "./reportEvidenceGate.js";

export function savedAnalysisState(claim, documents) {
  const analysis = claim?.ai_analysis || null;
  try {
    evidenceForDraft(analysis, documents);
    return { analysis, canDraft: true, reason: "" };
  } catch (error) {
    return { analysis, canDraft: false, reason: error.message };
  }
}

export function reviewedClaimValues(claim, analysis) {
  const values = { ...claim };
  for (const [key, suggestion] of Object.entries(analysis?.suggested_claim_data || {})) {
    const existing = values[key];
    if (existing === undefined || existing === null || existing === "" || (key === "business_line" && existing === "Unclassified")) {
      values[key] = suggestion;
    }
  }
  return values;
}
