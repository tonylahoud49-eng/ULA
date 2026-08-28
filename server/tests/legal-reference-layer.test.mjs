import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promptText, SYSTEM_INSTRUCTIONS } from "../ai/providers/openaiProvider.mjs";
import {
  loadApprovedStyleReferences,
  sanitizeReferenceNarrative,
  selectApplicableStyleReferences,
  selectLegalReferences,
  splitAnalysisReferences,
} from "../ai/referenceLayer.mjs";

const evidence = [{
  document_id: "claim-bill-1",
  document_name: "claim-bill-of-lading.txt",
  mime_type: "text/plain",
  extraction_status: "extracted",
  pages: [{
    page: 1,
    text: "Bill of Lading BL-44 records cargo delivery. The consignee alleges a shortage although the original carrier seal was intact.",
  }],
}];

test("legal reference retrieval is relevant, bounded, page-cited, and separate from claim evidence", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-legal-reference-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const indexPath = path.join(directory, "index.json");
  await fs.writeFile(indexPath, JSON.stringify({
    version: 1,
    chunks: [
      {
        source_id: "scrutton",
        title: "Scrutton on Charterparties and Bills of Lading",
        page: 410,
        chunk_index: 1,
        text: "A bill of lading may evidence receipt, shipment, carriage obligations and delivery. Carrier responsibility for shortage depends on the contract and evidence.",
      },
      {
        source_id: "mia",
        title: "Marine Insurance Act 1906",
        page: 17,
        chunk_index: 1,
        text: "The assured must prove a loss caused by a peril insured against, subject to the policy wording and proximate cause rules.",
      },
      {
        source_id: "unrelated",
        title: "Unrelated construction reference",
        page: 99,
        chunk_index: 1,
        text: "Concrete curing schedules and architectural measurements.",
      },
    ],
  }));

  const references = await selectLegalReferences({
    claim: { id: "claim-1", business_line: "Marine Cargo (Non-Reefer)" },
    evidence,
    indexPath,
    maxReferences: 2,
    maxExcerptCharacters: 180,
  });

  assert.ok(references.length >= 1 && references.length <= 2);
  assert.equal(references.some((item) => item.title.includes("Scrutton")), true);
  assert.equal(references.some((item) => item.title.includes("construction")), false);
  assert.ok(references.every((item) => item.source_role === "legal_reference_only"));
  assert.ok(references.every((item) => Number.isInteger(item.page) && item.excerpt.length <= 182));

  const styleReference = { title: "ULA style", source_role: "style_reference_only", section_order: ["Summary"] };
  const separated = splitAnalysisReferences([styleReference, ...references]);
  assert.deepEqual(separated.styleReferences, [styleReference]);
  assert.deepEqual(separated.legalReferences, references);

  const prompt = promptText({ id: "claim-1" }, evidence, [styleReference, ...references]);
  const evidencePosition = prompt.indexOf("EVIDENCE REGISTER AND EXTRACTED CONTENT");
  const stylePosition = prompt.indexOf("APPROVED STYLE REFERENCES");
  const legalPosition = prompt.indexOf("COLLECTIVE PROFESSIONAL KNOWLEDGE REFERENCES");
  assert.ok(evidencePosition >= 0 && stylePosition > evidencePosition && legalPosition > stylePosition);
  assert.match(prompt.slice(evidencePosition, stylePosition), /DOCUMENT ID: claim-bill-1/);
  assert.doesNotMatch(prompt.slice(evidencePosition, stylePosition), /Scrutton|Marine Insurance Act/);
  assert.match(prompt.slice(legalPosition), /legal_reference_only/);
  assert.match(SYSTEM_INSTRUCTIONS, /collectively as a professional knowledge base/i);
  assert.match(SYSTEM_INSTRUCTIONS, /specific claim, operative policy\/contract, jurisdiction and governing law/i);
  assert.match(SYSTEM_INSTRUCTIONS, /never combine rules indiscriminately/i);
  assert.match(SYSTEM_INSTRUCTIONS, /Never quote, summarize, cite, or name a reference/i);
  assert.match(prompt.slice(legalPosition), /never mix rules indiscriminately, quote, summarize, cite, or name/i);
});

test("reference titles and mechanical quotations are removed from provider narrative before reporting", () => {
  const excerpt = "Carrier responsibility for shortage depends on the contract of carriage, the bill of lading terms, delivery evidence, and the facts established for the particular shipment.";
  const references = [{
    reference_id: "scrutton:p410:c1",
    title: "Scrutton on Charterparties and Bills of Lading",
    excerpt,
    source_role: "legal_reference_only",
  }];
  const analysis = {
    classification: { business_line: "Marine Cargo (Non-Reefer)", confidence: 0.9, rationale: "Scrutton on Charterparties and Bills of Lading supports the classification.", sources: [] },
    document_types: [],
    evidence_findings: [
      { finding: "According to Scrutton on Charterparties and Bills of Lading, the intact seal makes forced entry less likely.", confidence: 0.9, sources: [] },
      { finding: excerpt, confidence: 0.8, sources: [] },
    ],
    summary: "Scrutton on Charterparties and Bills of Lading indicates that the shortage requires careful causation analysis.",
    warnings: ["See Scrutton on Charterparties and Bills of Lading, scrutton:p410:c1."],
    human_review_required: [],
  };

  const sanitized = sanitizeReferenceNarrative(analysis, references);
  const output = JSON.stringify(sanitized);
  assert.doesNotMatch(output, /Scrutton|scrutton:p410:c1|Carrier responsibility for shortage depends/i);
  assert.match(sanitized.evidence_findings[0].finding, /intact seal makes forced entry less likely/i);
  assert.equal(sanitized.evidence_findings.length, 1);
});

test("missing or invalid legal index returns no references without affecting claim analysis", async () => {
  assert.deepEqual(await selectLegalReferences({ indexPath: path.join(os.tmpdir(), "missing-ula-index.json"), evidence }), []);
});

test("client-scoped GFS style references activate only for matching current reefer evidence", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-gfs-style-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "global.json"), JSON.stringify({
    approved: true,
    profile_id: "global",
    title: "Global ULA style",
    section_order: ["Summary"],
    style_notes: ["Global rule"],
  }));
  await fs.writeFile(path.join(directory, "gfs.json"), JSON.stringify({
    approved: true,
    profile_id: "gfs-reefer",
    title: "GFS Reefer style",
    applies_to: {
      client_terms: ["Global Foods Solutions", "GFS FZCO"],
      evidence_terms_any: ["reefer", "frozen", "temperature"],
      business_lines: ["Marine Cargo (Reefer/GFS)"],
    },
    section_order: ["Temperature review"],
    style_notes: ["Use the GFS reefer methodology"],
  }));

  const references = await loadApprovedStyleReferences(directory);
  const gfsEvidence = [{ document_id: "gfs-1", document_name: "current.txt", pages: [{ page: 1, text: "Policy Holder Global Foods Solutions FZCO. Frozen cargo carried in a reefer container." }] }];
  const unrelatedEvidence = [{ document_id: "other-1", document_name: "current.txt", pages: [{ page: 1, text: "Unrelated assured shipped frozen cargo in a reefer container." }] }];
  const gfs = selectApplicableStyleReferences(references, { claim: { business_line: "Unclassified" }, evidence: gfsEvidence });
  const unrelated = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Reefer/GFS)" }, evidence: unrelatedEvidence });
  const wrongLine = selectApplicableStyleReferences(references, { claim: { business_line: "Property" }, evidence: gfsEvidence });

  assert.deepEqual(gfs.map((item) => item.profile_id).sort(), ["gfs-reefer", "global"]);
  assert.deepEqual(unrelated.map((item) => item.profile_id), ["global"]);
  assert.deepEqual(wrongLine.map((item) => item.profile_id), ["global"]);
  assert.match(promptText({ business_line: "Unclassified" }, gfsEvidence, references), /GFS Reefer style/);
  assert.doesNotMatch(promptText({ business_line: "Marine Cargo (Reefer/GFS)" }, unrelatedEvidence, references), /GFS Reefer style/);
});

test("air-carriage wording does not activate the maritime Scrutton reference", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-air-reference-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const indexPath = path.join(directory, "index.json");
  await fs.writeFile(indexPath, JSON.stringify({
    version: 1,
    chunks: [{
      source_id: "scrutton",
      title: "Scrutton on Charterparties and Bills of Lading",
      page: 410,
      chunk_index: 1,
      text: "The shipper and carrier record delivery to the consignee under a bill of lading.",
    }],
  }));

  const references = await selectLegalReferences({
    claim: { business_line: "Air Shipment (NET)" },
    evidence: [{
      document_id: "air-1",
      document_name: "air-waybill.txt",
      pages: [{ page: 1, text: "Air waybill: air carrier accepted cargo from shipper for delivery to consignee." }],
    }],
    indexPath,
  });

  assert.deepEqual(references, []);
});

test("Gard maritime guidance is retrieved for a grounded vessel but excluded from an air claim", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-gard-reference-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const indexPath = path.join(directory, "index.json");
  await fs.writeFile(indexPath, JSON.stringify({
    version: 1,
    chunks: [{
      source_id: "gard",
      title: "Gard Guidance on Maritime Claims",
      page: 42,
      chunk_index: 1,
      text: "Following a vessel grounding, preserve casualty evidence, consider pollution mitigation and investigate liability without delay.",
    }],
  }));

  const maritime = await selectLegalReferences({
    claim: { business_line: "Bulk Vessel" },
    evidence: [{
      document_id: "vessel-1",
      document_name: "casualty-report.txt",
      pages: [{ page: 1, text: "The vessel grounding caused a potential oil spill and maritime liability claim." }],
    }],
    indexPath,
  });
  const air = await selectLegalReferences({
    claim: { business_line: "Air Shipment (NET)" },
    evidence: [{
      document_id: "air-2",
      document_name: "air-claim.txt",
      pages: [{ page: 1, text: "The air carrier reported cargo damage under an air waybill." }],
    }],
    indexPath,
  });

  assert.equal(maritime.length, 1);
  assert.equal(maritime[0].title, "Gard Guidance on Maritime Claims");
  assert.deepEqual(air, []);
});
