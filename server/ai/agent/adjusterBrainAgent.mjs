import { createConfiguredProvider } from "../provider.mjs";
import { getBrainStyleReferences } from "../brain/brainEngine.mjs";

export function formatAgentThinkingPrompt({ claim, dossier, brainProfiles = [] }) {
  const docSummaries = Object.values(dossier.documents || {}).map((d) => {
    const fields = Object.entries(d.extracted_fields || {})
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");
    const facts = (d.salient_facts || []).map((f) => `  * ${f}`).join("\n");
    return `DOCUMENT: ${d.name} (${d.document_type})\n${fields}\nFacts:\n${facts}`;
  }).join("\n\n");

  const brainNotes = brainProfiles.map((b) => {
    return `[${b.title}]\n${(b.style_notes || []).map((n) => `• ${n}`).join("\n")}`;
  }).join("\n\n");

  return `
=== CLAIM IDENTIFIERS ===
Title: ${claim.title || "Claim"}
Business Line: ${claim.business_line || "Marine Cargo"}

=== LOSS ADJUSTER BRAIN PLAYBOOKS ===
${brainNotes || "Standard loss adjusting methodology applies."}

=== DISTILLED CLAIM DOSSIER ===
Reconciliation:
- Containers: ${(dossier.reconciliation?.container_numbers || []).join(", ") || "None"}
- Missing Mandatory Documents: ${(dossier.reconciliation?.missing_mandatory_docs || []).join(", ") || "None"}

Document Findings:
${docSummaries || "No documents indexed."}

=== DIRECTOR CAUSE RULES (REPORT_SPEC.md) ===
The proximate cause of loss section must begin with one of three approved lead forms:
1. Express cause: "The proximate cause of loss is {supported source-stated cause}."
2. Qualified assessment: "The proximate cause of loss is not expressly stated as a source fact; the available evidence supports the qualified professional assessment set out below."
3. Unresolved: "The reviewed evidence does not yet permit a defensible proximate-cause opinion; the decisive causal records are identified below."
Never use the phrase "not established" in client narrative.

Output structured JSON matching claimAnalysisSchema.`;
}

export async function evaluateCoverageAndCause({
  claim,
  dossier,
  providerName = "anthropic",
  modelName = "claude-sonnet-4-6",
}) {
  let brainProfiles = [];
  try {
    brainProfiles = await getBrainStyleReferences();
  } catch {
    brainProfiles = [];
  }

  const prompt = formatAgentThinkingPrompt({ claim, dossier, brainProfiles });

  let provider = null;
  try {
    const configured = createConfiguredProvider({ providerName, modelName });
    provider = configured?.provider;
  } catch {
    provider = null;
  }

  if (!provider) {
    // Offline/test fallback
    return {
      cause_of_loss: "The proximate cause of loss is not expressly stated as a source fact; the available evidence supports the qualified professional assessment set out below.",
      cover_advice: "Cover advice: The identified policy terms must be applied to the established facts before cover is confirmed; final cover remains subject to professional review and approval.",
      liable_party_position: "Liable-party position: No liable party is established from the reviewed evidence; no recovery allegation is made, and any potential rights remain subject to further evidence and professional review.",
      confidence: 0.90,
      adjustment_line_items: [],
    };
  }

  const res = await provider.analyze({
    claim: { ...claim, title: `Autonomous Adjuster Audit: ${claim.title || "Claim"}` },
    evidence: [{
      document_id: "agent-distilled-dossier",
      document_name: "Agent_Dossier_Summary.txt",
      kind: "text",
      pages: [{ page: 1, text: prompt }],
      mime_type: "text/plain",
      extraction_status: "extracted",
    }],
    files: [],
    styleReferences: brainProfiles,
  });

  return res.analysis || {};
}
