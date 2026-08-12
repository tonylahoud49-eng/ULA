import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIProvider } from "../ai/providers/openaiProvider.mjs";
import { getAIStatus } from "../ai/provider.mjs";

const textSource = {
  document_id: "combined-1",
  document_name: "upload-a.docx",
  page: null,
  supporting_text: "Claimant: Example Trading SAL Policy No: POL-44 Date of Loss: 12 May 2026",
  confidence: 0.96,
  evidence_mode: "extracted_text",
};

const structuredAnalysis = {
  classification: {
    business_line: "Marine Cargo (Non-Reefer)",
    confidence: 0.91,
    rationale: "The claim form describes dry cargo transit damage.",
    sources: [textSource],
  },
  document_types: [{
    document_type: "Claim Form",
    confidence: 0.96,
    sufficient_information: true,
    rationale: "The combined file contains claimant, policy, loss date, and loss circumstances.",
    sources: [textSource],
  }],
  fields: [{
    field: "insured",
    value: "Example Trading SAL",
    normalized_value: "Example Trading SAL",
    confidence: 0.96,
    requires_confirmation: false,
    sources: [{ ...textSource, supporting_text: "Claimant: Example Trading SAL" }],
  }],
  missing_documents: [],
  evidence_findings: [],
  summary: "The combined document includes substantive claim-form content.",
  warnings: [],
  human_review_required: ["Coverage", "Cause of loss"],
};

test("configuration reports an unavailable state instead of enabling a local fallback", () => {
  const status = getAIStatus({ AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-5.6-terra" });
  assert.equal(status.configured, false);
  assert.match(status.reason, /OPENAI_API_KEY/);
});

test("provider makes one structured Responses API request containing all text, PDF, and image evidence", async () => {
  let request;
  const client = {
    responses: {
      parse: async (value) => {
        request = value;
        return { id: "resp_test", output_parsed: structuredAnalysis };
      },
    },
  };
  const provider = createOpenAIProvider({ client, model: "gpt-5.6-terra" });
  const evidence = [
    {
      document_id: "combined-1",
      document_name: "upload-a.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "document",
      extraction_status: "extracted",
      pages: [{ page: null, text: "Claimant: Example Trading SAL Policy No: POL-44 Date of Loss: 12 May 2026" }],
    },
    {
      document_id: "scan-2",
      document_name: "survey-scan.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      extraction_status: "vision-required",
      pages: [],
    },
    {
      document_id: "photo-3",
      document_name: "damage.jpg",
      mime_type: "image/jpeg",
      kind: "image",
      extraction_status: "vision-required",
      pages: [],
    },
  ];
  const files = [
    { mimetype: evidence[0].mime_type, buffer: Buffer.from("docx") },
    { mimetype: evidence[1].mime_type, buffer: Buffer.from("pdf") },
    { mimetype: evidence[2].mime_type, buffer: Buffer.from("image") },
  ];

  const result = await provider.analyze({ claim: { id: "claim-1" }, evidence, files });
  assert.equal(result.response_id, "resp_test");
  assert.equal(result.analysis.document_types[0].document_type, "Claim Form");
  assert.equal(result.analysis.missing_documents.some((item) => item.document_type === "Claim Form"), false);
  assert.equal(request.model, "gpt-5.6-terra");
  const content = request.input[0].content;
  assert.match(content[0].text, /combined-1/);
  assert.match(content[0].text, /scan-2/);
  assert.match(content[0].text, /photo-3/);
  assert.equal(content.filter((item) => item.type === "input_file").length, 2);
  assert.equal(content.filter((item) => item.type === "input_image").length, 1);
  assert.match(content.find((item) => item.type === "input_file" && item.filename === "survey-scan.pdf").file_data, /^data:application\/pdf;base64,/);
});

test("unverifiable extracted-text facts are removed instead of being fabricated", async () => {
  const ungrounded = structuredClone(structuredAnalysis);
  ungrounded.fields[0].sources[0].supporting_text = "A name that is not in the document";
  const provider = createOpenAIProvider({
    model: "gpt-5.6-terra",
    client: { responses: { parse: async () => ({ id: "resp_grounding", output_parsed: ungrounded }) } },
  });
  const evidence = [{
    document_id: "combined-1",
    document_name: "upload-a.docx",
    mime_type: "text/plain",
    kind: "text",
    extraction_status: "extracted",
    pages: [{ page: null, text: textSource.supporting_text }],
  }];
  const result = await provider.analyze({
    claim: { id: "claim-1" },
    evidence,
    files: [{ mimetype: "text/plain", buffer: Buffer.from(textSource.supporting_text) }],
  });
  assert.equal(result.analysis.fields[0].value, null);
  assert.equal(result.analysis.fields[0].requires_confirmation, true);
  assert.match(result.analysis.warnings.join(" "), /no verifiable source/i);
});
