import test from "node:test";
import assert from "node:assert/strict";
import { formatAgentThinkingPrompt } from "../ai/agent/adjusterBrainAgent.mjs";

test("formatAgentThinkingPrompt formats compact dossier and injects brain references", () => {
  const dossier = {
    claim_id: "CLM-100",
    documents: {
      "doc-1": {
        name: "Survey.pdf",
        document_type: "Survey Report",
        extracted_fields: { cause_of_loss: "Reefer malfunction in transit" },
        salient_facts: ["Partlow chart confirms temperature spike after feeder vessel discharge."]
      }
    },
    reconciliation: {
      missing_mandatory_docs: [],
      container_numbers: ["MSKU1234567"]
    }
  };

  const prompt = formatAgentThinkingPrompt({
    claim: { title: "Spotted Prawn Consignment", business_line: "Marine Cargo (Reefer/GFS)" },
    dossier,
    brainProfiles: [{ title: "Learned Reefer Wisdom", style_notes: ["Verify PTI within 48h"] }]
  });

  assert.ok(prompt.includes("=== DISTILLED CLAIM DOSSIER ==="));
  assert.ok(prompt.includes("MSKU1234567"));
  assert.ok(prompt.includes("=== LOSS ADJUSTER BRAIN PLAYBOOKS ==="));
  assert.ok(prompt.includes("Verify PTI within 48h"));
  assert.ok(prompt.includes("DIRECTOR CAUSE RULES"));
});
