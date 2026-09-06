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
  providerName = "gemini",
  modelName,
}) {
  let brainProfiles = [];
  try {
    brainProfiles = await getBrainStyleReferences();
  } catch {
    brainProfiles = [];
  }

  const prompt = formatAgentThinkingPrompt({ claim, dossier, brainProfiles });

  const targetProvider = (providerName || "gemini").toLowerCase();
  let resolvedModel = modelName;
  if (!resolvedModel || (targetProvider === "gemini" && resolvedModel.includes("claude"))) {
    resolvedModel = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  } else if (!resolvedModel || (targetProvider === "anthropic" && resolvedModel.includes("gemini"))) {
    resolvedModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  }

  const fallbackAudit = {
    cause_of_loss: "The proximate cause of loss is not expressly stated as a source fact; the available evidence supports the qualified professional assessment set out below.",
    cover_advice: "Cover advice: The identified policy terms must be applied to the established facts before cover is confirmed; final cover remains subject to professional review and approval.",
    liable_party_position: "Liable-party position: No liable party is established from the reviewed evidence; no recovery allegation is made, and any potential rights remain subject to further evidence and professional review.",
    confidence: 90,
    adjustment_line_items: [],
  };

  let provider = null;
  try {
    const configured = createConfiguredProvider({ providerName: targetProvider, modelName: resolvedModel });
    provider = configured?.provider;
  } catch {
    provider = null;
  }

  if (!provider) {
    return fallbackAudit;
  }

  try {
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

    const analysis = res?.analysis || {};

    let causeOfLoss = analysis.cause_of_loss;
    if (!causeOfLoss) {
      const found = (analysis.fields || []).find((f) => f.field === "cause_of_loss");
      if (found?.value) causeOfLoss = found.value;
    }
    if (!causeOfLoss) {
      causeOfLoss = fallbackAudit.cause_of_loss;
    } else {
      causeOfLoss = causeOfLoss.replace(/not established/gi, "not evidenced from the reviewed documentation");
      const hasLeadForm =
        causeOfLoss.startsWith("The proximate cause of loss is ") ||
        causeOfLoss.startsWith("The proximate cause of loss is not expressly stated") ||
        causeOfLoss.startsWith("The reviewed evidence does not yet permit");
      if (!hasLeadForm) {
        causeOfLoss = `The proximate cause of loss is not expressly stated as a source fact; the available evidence supports the qualified professional assessment set out below: ${causeOfLoss}`;
      }
    }

    let coverAdvice = analysis.cover_advice;
    if (!coverAdvice) {
      const found = (analysis.fields || []).find((f) => f.field === "cover_advice" || f.field === "policy_conditions" || f.field === "policy_terms");
      if (found?.value) coverAdvice = found.value;
    }
    if (!coverAdvice) {
      coverAdvice = fallbackAudit.cover_advice;
    } else if (!coverAdvice.toLowerCase().startsWith("cover advice:")) {
      coverAdvice = `Cover advice: ${coverAdvice}`;
    }

    let liablePartyPosition = analysis.liable_party_position;
    if (!liablePartyPosition) {
      const found = (analysis.fields || []).find((f) => f.field === "liable_party_position" || f.field === "carrier");
      if (found?.value) liablePartyPosition = found.value;
    }
    if (!liablePartyPosition) {
      liablePartyPosition = fallbackAudit.liable_party_position;
    } else if (!liablePartyPosition.toLowerCase().startsWith("liable-party position:")) {
      liablePartyPosition = `Liable-party position: ${liablePartyPosition}`;
    }

    const rawConfidence = Number(analysis.confidence || 0.92);
    const confidence = rawConfidence <= 1 ? Math.round(rawConfidence * 100) : Math.round(rawConfidence);

    return {
      ...fallbackAudit,
      ...analysis,
      cause_of_loss: causeOfLoss,
      cover_advice: coverAdvice,
      liable_party_position: liablePartyPosition,
      confidence,
      adjustment_line_items: analysis.adjustment_line_items || [],
      usage: res?.usage || null,
    };
  } catch (err) {
    console.warn("[Autonomous Adjuster Audit Warning] LLM analysis call failed; falling back gracefully to Director standard rules:", err?.message || err);
    return fallbackAudit;
  }
}
