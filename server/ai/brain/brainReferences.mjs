import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../referenceLayer.mjs";

export async function loadAnalysisReferences({ directory, store, actor, claim = {} }) {
  const core = await loadApprovedStyleReferences(directory);
  const line = String(claim.business_line || claim.ai_suggested_business_line || "").trim().toLowerCase();
  if (!line || ["unclassified", "requires review", "other / requires review"].includes(line)) return core;
  const active = await store.references(actor, line);
  const candidates = active.filter((reference) => reference.approved === true && reference.is_brain_knowledge === true
    && reference.applies_to?.business_lines?.some((value) => value.toLowerCase() === line));
  return [...core, ...candidates];
}

// Internal review history only. Never part of claim evidence or client narrative.
export function usedBrainReferences(references, { claim, evidence }) {
  return selectApplicableStyleReferences(references, { claim, evidence }).filter((reference) => reference.is_brain_knowledge).map((reference) => ({
    report_id: reference.brain_report_id, revision: reference.revision, title: reference.title,
  }));
}

export function mergeUsedBrainReferences(results) {
  return [...new Map(results.flatMap((result) => result?.methodology_references || []).map((reference) => [`${reference.report_id}:${reference.revision}`, reference])).values()];
}
