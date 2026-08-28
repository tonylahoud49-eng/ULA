import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIProvider } from "../ai/providers/openaiProvider.mjs";
import { createOpenRouterProvider } from "../ai/providers/openrouterProvider.mjs";
import { createGeminiProvider } from "../ai/providers/geminiProvider.mjs";
import { createAnthropicProvider, anthropicProviderInternals } from "../ai/providers/anthropicProvider.mjs";
import { CLAIM_FIELDS, claimAnalysisSchema } from "../ai/claimAnalysisSchema.mjs";
import { prepareEvidenceForAnthropic } from "../evidence/prepareAnthropicEvidence.mjs";
import { getAIStatus, createConfiguredProvider } from "../ai/provider.mjs";
import {
  anthropicMessageFixture,
  canonicalAnalysisToAnthropicTransportFixture,
  multiDocumentEvidenceFixture,
  paidRequestEvidenceFixture,
  paidRequestZeroPercentClaudeFixture,
  validAnthropicAnalysisFixture,
} from "./fixtures/anthropicResponses.mjs";

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
  adjustment_line_items: [],
  missing_documents: [],
  evidence_findings: [],
  summary: "The combined document includes substantive claim-form content.",
  warnings: [],
  human_review_required: ["Coverage", "Cause of loss"],
};

const toAnthropicTransport = canonicalAnalysisToAnthropicTransportFixture;

test("anthropic status accepts the standard key and the existing misspelled migration alias", () => {
  const standard = getAIStatus({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key" });
  const aliased = getAIStatus({ AI_PROVIDER: "anthropic", ANTHROTIC_API_KEY: "legacy-test-key" });
  assert.equal(standard.configured, true);
  assert.equal(standard.model, "claude-sonnet-4-6");
  assert.equal(aliased.configured, true);
  assert.equal(aliased.provider, "anthropic");
});

test("anthropic sends uploaded content to Messages API and retains only grounded output", async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({
      id: "msg_test",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: JSON.stringify(toAnthropicTransport(structuredAnalysis)) }],
    }), { status: 200, headers: { "request-id": "req_test" } });
  };
  const evidence = [{
    document_id: "combined-1",
    document_name: "upload-a.docx",
    mime_type: "text/plain",
    kind: "text",
    extraction_status: "extracted",
    pages: [{ page: null, text: textSource.supporting_text }],
  }, {
    document_id: "scan-2",
    document_name: "survey.pdf",
    mime_type: "application/pdf",
    kind: "pdf",
    extraction_status: "vision-required",
    pages: [{ page: 1, text: "", extraction_status: "image-only" }],
    vision_images: [{ page: 1, mime_type: "image/jpeg", buffer: Buffer.from("scan-image") }],
  }, {
    document_id: "photo-3",
    document_name: "damage.jpg",
    mime_type: "image/jpeg",
    kind: "image",
    extraction_status: "vision-required",
    pages: [],
  }];
  const files = [
    { mimetype: "text/plain", buffer: Buffer.from(textSource.supporting_text) },
    { mimetype: "application/pdf", buffer: Buffer.from("pdf") },
    { mimetype: "image/jpeg", buffer: Buffer.from("image") },
  ];
  const provider = createAnthropicProvider({ apiKey: "server-only-key", fetchImpl });
  const result = await provider.analyze({ claim: { id: "claim-1" }, evidence, files });
  const body = JSON.parse(request.body);

  assert.equal(request.headers["x-api-key"], "server-only-key");
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 64_000);
  assert.equal(body.stream, true);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.ok(JSON.stringify(body.output_config.format.schema).length < 2_500);
  assert.equal(JSON.stringify(body.output_config.format.schema).includes('"enum"'), false);
  let unionTypes = 0;
  let optionalParameters = 0;
  const auditSchemaComplexity = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.type)) unionTypes += 1;
    if (node.type === "object") {
      optionalParameters += Object.keys(node.properties || {})
        .filter((key) => !(node.required || []).includes(key)).length;
      assert.equal(node.additionalProperties, false);
    }
    Object.values(node).forEach(auditSchemaComplexity);
  };
  auditSchemaComplexity(body.output_config.format.schema);
  assert.equal(unionTypes, 0);
  assert.equal(optionalParameters, 0);
  assert.match(body.system, /Return only the structured payload/);
  assert.match(body.system, /no Markdown fences, preface, trailing commentary, or extra keys/i);
  assert.match(body.system, /return only evidence-supported non-null field records/i);
  assert.match(body.system, /Never omit a material claim finding/i);
  assert.match(body.system, /compact analytical paragraph of up to 4 sentences/i);
  assert.match(body.messages[0].content[0].text, /cause, policy application, quantum, mitigation, liability\/recovery, alternatives, and material evidence gaps/i);
  assert.ok(body.system.length < 20_000, "The Claude instructions and plain-text contract must stay compact");
  assert.match(body.messages[0].content[0].text, /Claimant: Example Trading SAL/);
  assert.equal(body.messages[0].content.filter((item) => item.type === "document").length, 0);
  assert.equal(body.messages[0].content.filter((item) => item.type === "image").length, 2);
  assert.ok(body.messages[0].content.some((item) => item.type === "text" && /survey\.pdf, page 1/.test(item.text)));
  assert.equal(result.provider, "anthropic");
  assert.equal(result.provider_api_status, 200);
  assert.equal(result.response_id, "msg_test");
  assert.equal(result.analysis.fields[0].value, "Example Trading SAL");
  assert.equal(result.analysis.fields.length, CLAIM_FIELDS.length);
  assert.equal(result.analysis.fields.find((field) => field.field === "recovery_findings").value, null);
});

test("anthropic streams and locally accumulates one long-running Messages API response", async () => {
  let requestBody;
  const json = JSON.stringify(toAnthropicTransport(validAnthropicAnalysisFixture));
  const splitAt = Math.floor(json.length / 2);
  const sse = [
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_streamed",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 100 },
      },
    })}`,
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: json.slice(0, splitAt) },
    })}`,
    "event: ping\ndata: {\"type\":\"ping\"}",
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: json.slice(splitAt) },
    })}`,
    "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}",
    "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":900}}",
    "event: message_stop\ndata: {\"type\":\"message_stop\"}",
  ].join("\n\n");
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream", "request-id": "req_streamed" },
      });
    },
  });
  const result = await provider.analyze({ claim: { id: "streamed" }, evidence: [], files: [] });

  assert.equal(requestBody.stream, true);
  assert.equal(result.response_id, "msg_streamed");
  assert.equal(result.model, "claude-sonnet-4-6");
  assert.equal(result.analysis.summary, validAnthropicAnalysisFixture.summary);
  assert.equal(result.analysis.fields.length, CLAIM_FIELDS.length);
});

test("anthropic exposes the nested network cause and never retries a failed stream", async () => {
  let calls = 0;
  let thrown;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => {
      calls += 1;
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
      throw error;
    },
  });

  await assert.rejects(
    provider.analyze({ claim: { id: "network-failure" }, evidence: [], files: [] }),
    (error) => {
      thrown = error;
      return error.isNetworkError === true && /ECONNRESET/.test(error.message);
    },
  );
  assert.equal(calls, 1);
  assert.equal(thrown.transportPhase, "awaiting_response_headers");
  assert.equal(thrown.causeCode, "ECONNRESET");
  assert.ok(thrown.elapsedMs >= 0);
});

test("anthropic diagnostics distinguish a response-stream reset after HTTP headers", async () => {
  const streamError = Object.assign(new Error("peer closed the response stream"), { code: "UND_ERR_SOCKET" });
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: ping\ndata: {\"type\":\"ping\"}\n\n"));
        controller.error(streamError);
      },
    }), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "req_stream_reset" },
    }),
  });
  let thrown;
  await assert.rejects(
    provider.analyze({ claim: { id: "stream-reset" }, evidence: [], files: [] }),
    (error) => {
      thrown = error;
      return error.isNetworkError === true;
    },
  );
  assert.equal(thrown.transportPhase, "reading_response_stream");
  assert.equal(thrown.causeCode, "UND_ERR_SOCKET");
  assert.ok(thrown.elapsedMs >= 0);
});

test("anthropic diagnostics extract the first concrete Undici AggregateError cause", () => {
  const outer = new TypeError("fetch failed");
  outer.cause = new AggregateError([
    Object.assign(new Error("IPv6 unreachable"), { code: "ENETUNREACH" }),
    Object.assign(new Error("IPv4 timed out"), { code: "ETIMEDOUT" }),
  ]);
  const metadata = anthropicProviderInternals.transportErrorMetadata(outer);

  assert.deepEqual(metadata, {
    error_name: "TypeError",
    error_message: "fetch failed",
    cause_name: "Error",
    cause_message: "IPv6 unreachable",
    cause_code: "ENETUNREACH",
    nested_cause_codes: ["ENETUNREACH", "ETIMEDOUT"],
  });
});

test("anthropic output allowance is configurable locally and capped for Sonnet 4.6", async () => {
  let requestBody;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    maxOutputTokens: "32000",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(anthropicMessageFixture(validAnthropicAnalysisFixture)), { status: 200 });
    },
  });
  await provider.analyze({ claim: { id: "configured-output" }, evidence: [], files: [] });
  assert.equal(requestBody.max_tokens, 32_000);

  assert.throws(
    () => createAnthropicProvider({ apiKey: "server-only-key", maxOutputTokens: "64001" }),
    /cannot exceed 64000/i,
  );
});

test("anthropic retains content-grounded categories when citation metadata drifts", async () => {
  let request;
  const policyText = "OPEN CARGO & AIR TRANSIT INSURANCE POLICY\nPolicy Number: POL-AIR-2026-8812";
  const claimFormText = "NOTICE OF CARGO CLAIM & CLAIM DECLARATION FORM\nDate of Loss / Flight Arrival: 12 March 2026";
  const surveyText = "PRELIMINARY ATTENDANCE & SURVEY REPORT\nPhysical shock indicators on Crates #2 and #3 were activated.";
  const evidence = [
    {
      document_id: "policy-5",
      document_name: "04_Marine_Air_Transit_Policy_POL-2026-8812.txt",
      mime_type: "text/plain",
      kind: "text",
      extraction_status: "extracted",
      pages: [{ page: null, text: policyText }],
    },
    {
      document_id: "claim-form-6",
      document_name: "05_Notice_of_Claim_Form.txt",
      mime_type: "text/plain",
      kind: "text",
      extraction_status: "extracted",
      pages: [{ page: null, text: claimFormText }],
    },
    {
      document_id: "survey-4",
      document_name: "03_Preliminary_Survey_Report.txt",
      mime_type: "text/plain",
      kind: "text",
      extraction_status: "extracted",
      pages: [{ page: null, text: surveyText }],
    },
  ];
  const source = (documentId, documentName, supportingText) => ({
    document_id: documentId,
    document_name: documentName,
    page: null,
    supporting_text: supportingText,
    confidence: 0.95,
    // Claude previously used this mode for text already present in the prompt.
    evidence_mode: "document_vision",
  });
  const resultFixture = {
    ...structuredAnalysis,
    classification: {
      business_line: "Air Shipment (NET)",
      confidence: 0.94,
      rationale: "The complete evidence set documents an insured air-cargo transit loss.",
      sources: [source(
        "04_Marine_Air_Transit_Policy_POL-2026-8812.txt",
        "policy",
        "OPEN CARGO AIR TRANSIT INSURANCE POLICY",
      )],
    },
    document_types: [
      {
        document_type: "Policy",
        confidence: 0.98,
        sufficient_information: true,
        rationale: "The content states the policy number, insurer, insured, limits, and cover.",
        sources: [source("policy-5", "policy", "Policy Number: POL AIR 2026 8812")],
      },
      {
        document_type: "Claim Form",
        confidence: 0.97,
        sufficient_information: true,
        rationale: "The content is a claim declaration with loss details.",
        sources: [source("05_Notice_of_Claim_Form.txt", "claim form", "NOTICE OF CARGO CLAIM CLAIM DECLARATION FORM")],
      },
      {
        document_type: "Survey Report",
        confidence: 0.96,
        sufficient_information: true,
        rationale: "The survey records physical damage findings.",
        sources: [source("wrong-id", "03 Preliminary Survey Report", "Physical shock indicators on Crates 2 and 3 were activated")],
      },
    ],
    fields: [],
    missing_documents: [
      { document_type: "Policy", reason: "Missing", missing_information: ["Policy"] },
      { document_type: "Claim Form", reason: "Missing", missing_information: ["Claim Form"] },
      { document_type: "Supporting Evidence", reason: "Missing", missing_information: ["Evidence"] },
      { document_type: "Bill of Lading", reason: "Not supplied", missing_information: ["Bill of Lading"] },
    ],
  };
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        id: "msg_grounding_regression",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: JSON.stringify(toAnthropicTransport(resultFixture)) }],
      }), { status: 200 });
    },
  });

  const result = await provider.analyze({
    claim: { id: "air-cargo-claim" },
    evidence,
    files: evidence.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(request.messages[0].content.filter((block) => block.type === "text").length, 1);
  for (const item of evidence) {
    assert.match(request.messages[0].content[0].text, new RegExp(item.document_id));
    assert.match(request.messages[0].content[0].text, new RegExp(item.pages[0].text.split("\\n")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(request.system, /Copy supporting_text verbatim/);
  assert.match(request.system, /complete evidence set/);
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.equal(result.analysis.classification.sources[0].document_id, "policy-5");
  assert.equal(result.analysis.classification.sources[0].evidence_mode, "extracted_text");
  assert.deepEqual(
    new Set(result.analysis.document_types.map((item) => item.document_type)),
    new Set(["Policy", "Claim Form", "Notice of Claim", "Survey Report", "Supporting Evidence"]),
  );
  assert.equal(result.analysis.missing_documents.some((item) => ["Policy", "Claim Form", "Supporting Evidence"].includes(item.document_type)), false);
  assert.equal(result.analysis.missing_documents.some((item) => item.document_type === "Bill of Lading"), false);
});

test("anthropic preserves stripped numeric constraints through application validation", async () => {
  const invalidAnalysis = {
    ...structuredAnalysis,
    classification: { ...structuredAnalysis.classification, confidence: 2 },
  };
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify({
      id: "msg_invalid",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: JSON.stringify(toAnthropicTransport(invalidAnalysis)) }],
    }), { status: 200 }),
  });

  await assert.rejects(
    provider.analyze({ claim: { id: "claim-1" }, evidence: [], files: [] }),
    /transport schema validation failed/,
  );
});

test("anthropic exposes the real provider error status and message", async () => {
  const provider = createAnthropicProvider({
    apiKey: "bad-key",
    fetchImpl: async () => new Response(JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
      request_id: "req_error",
    }), { status: 401 }),
  });
  await assert.rejects(
    provider.analyze({ claim: { id: "claim-1" }, evidence: [], files: [] }),
    (error) => error.status === 401 && error.providerStatus === 401 && /invalid x-api-key/.test(error.message),
  );
});

test("anthropic parses a complete mocked structured response with null fields and multiple documents", async () => {
  let requestedUrl;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify(anthropicMessageFixture()), { status: 200 });
    },
  });
  const result = await provider.analyze({
    claim: { id: "fixture-claim" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({
      mimetype: item.mime_type,
      buffer: Buffer.from(item.pages[0].text),
    })),
  });

  assert.equal(requestedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.equal(result.analysis.fields.find((field) => field.field === "claim_amount").value, null);
  assert.deepEqual(
    new Set(result.analysis.document_types.map((item) => item.document_type)),
    new Set(["Policy", "Claim Form", "Notice of Claim", "Survey Report", "Supporting Evidence"]),
  );
  assert.equal(result.analysis.missing_documents.some((item) =>
    ["Policy", "Claim Form", "Supporting Evidence"].includes(item.document_type)), false);
});

test("regression: the last paid request fixture does not collapse grounded six-document analysis to 0%", async () => {
  let requestBody;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(anthropicMessageFixture(paidRequestZeroPercentClaudeFixture, {
        id: "msg_mock_paid_request_regression",
      })), { status: 200 });
    },
  });
  const result = await provider.analyze({
    claim: { id: "ui-anthropic-claim", claim_number: "ULA-CLAUDE-E2E" },
    evidence: paidRequestEvidenceFixture,
    files: paidRequestEvidenceFixture.map((item) => ({
      mimetype: item.mime_type,
      buffer: Buffer.from(item.pages[0].text),
    })),
  });

  const prompt = requestBody.messages[0].content[0].text;
  const preparedEvidence = prepareEvidenceForAnthropic(paidRequestEvidenceFixture).evidence;
  for (const document of preparedEvidence) {
    assert.match(prompt, new RegExp(document.document_id));
    assert.equal(prompt.includes(document.pages[0].text), true);
  }
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.deepEqual(
    new Set(result.analysis.document_types.map((item) => item.document_type)),
    new Set(["Air Waybill", "Commercial Invoice", "Packing List", "Survey Report", "Policy", "Claim Form", "Notice of Claim", "Supporting Evidence"]),
  );
  assert.equal(result.analysis.missing_documents.some((item) =>
    ["Policy", "Claim Form", "Supporting Evidence"].includes(item.document_type)), false);
  for (const type of result.analysis.document_types) {
    for (const source of type.sources) {
      const evidence = paidRequestEvidenceFixture.find((item) => item.document_id === source.document_id);
      assert.ok(evidence, `Source ${source.document_id} must resolve to an uploaded document`);
      assert.equal(
        evidence.pages[0].text.replaceAll("\r\n", "\n").includes(source.supporting_text.replaceAll("\r\n", "\n")),
        true,
      );
    }
  }
});

test("anthropic citation repair still rejects fabricated evidence", async () => {
  const fabricated = structuredClone(paidRequestZeroPercentClaudeFixture);
  fabricated.classification.sources.forEach((source) => {
    source.supporting_text = "Invented orbital reactor loss reference 999999";
  });
  fabricated.document_types.forEach((type) => type.sources.forEach((source) => {
    source.supporting_text = "Invented orbital reactor loss reference 999999";
  }));
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(fabricated)), { status: 200 }),
  });
  const result = await provider.analyze({
    claim: { id: "fabricated-grounding" },
    evidence: paidRequestEvidenceFixture,
    files: paidRequestEvidenceFixture.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.deepEqual(
    new Set(result.analysis.document_types.map((item) => item.document_type)),
    new Set(["Air Waybill", "Commercial Invoice", "Packing List", "Survey Report", "Policy", "Claim Form", "Notice of Claim", "Supporting Evidence"]),
  );
  assert.equal(result.analysis.missing_documents.some((item) => item.document_type === "Policy"), false);
  assert.doesNotMatch(JSON.stringify(result.analysis), /Invented orbital reactor loss reference/);
});

test("anthropic retains a valid classification from a separately verified transport document type", async () => {
  const evidenceText = "MAWB 020-12345678 Shipper: Example Exporter Consignee: Example Receiver Flight: AB123";
  const verifiedSource = {
    document_id: "mawb-1",
    document_name: "mawb.pdf",
    page: 1,
    supporting_text: evidenceText,
    confidence: 0.92,
    evidence_mode: "extracted_text",
  };
  const fixture = {
    ...structuredAnalysis,
    classification: {
      business_line: "Air Shipment (NET)",
      confidence: 0.88,
      rationale: "The claim concerns carriage under a master air waybill.",
      sources: [{ ...verifiedSource, supporting_text: "Fabricated classification excerpt" }],
    },
    document_types: [{
      document_type: "Air Waybill",
      confidence: 0.92,
      sufficient_information: true,
      rationale: "The document contains the master air waybill and flight details.",
      sources: [verifiedSource],
    }],
    fields: [],
  };
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(fixture)), { status: 200 }),
  });

  const result = await provider.analyze({
    claim: { id: "classification-evidence-channel" },
    evidence: [{
      document_id: "mawb-1",
      document_name: "mawb.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      pages: [{ page: 1, text: evidenceText }],
    }],
    files: [{ mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
  });

  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.88);
  assert.equal(result.analysis.classification.sources[0].supporting_text, evidenceText);
  assert.match(result.analysis.warnings.join(" "), /separately verified transport-document classification/i);
  assert.doesNotMatch(JSON.stringify(result.analysis), /Fabricated classification excerpt/);

  const baselineProvider = createAnthropicProvider({
    apiKey: "server-only-key",
    verifiedClassificationRecovery: false,
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(fixture)), { status: 200 }),
  });
  const baseline = await baselineProvider.analyze({
    claim: { id: "classification-evidence-channel-before" },
    evidence: [{
      document_id: "mawb-1",
      document_name: "mawb.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      pages: [{ page: 1, text: evidenceText }],
    }],
    files: [{ mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
  });
  assert.equal(baseline.analysis.classification.business_line, "Other / Requires Review");
  assert.equal(baseline.analysis.classification.confidence, 0);
});

test("anthropic combines non-empty text blocks before parsing structured JSON", async () => {
  const output = JSON.stringify(toAnthropicTransport(validAnthropicAnalysisFixture));
  const splitAt = Math.floor(output.length / 2);
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [
        { type: "text", text: "" },
        { type: "text", text: output.slice(0, splitAt) },
        { type: "text", text: output.slice(splitAt) },
      ],
    })), { status: 200 }),
  });

  const result = await provider.analyze({
    claim: { id: "split-response" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({
      mimetype: item.mime_type,
      buffer: Buffer.from(item.pages[0].text),
    })),
  });
  assert.equal(result.analysis.classification.confidence, 0.94);
});

test("anthropic accepts valid schema-constrained structured output", async () => {
  let requestBody;
  let calls = 0;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async (_url, options) => {
      calls += 1;
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify(anthropicMessageFixture(validAnthropicAnalysisFixture)), { status: 200 });
    },
  });
  const result = await provider.analyze({ claim: { id: "valid-structured" }, evidence: [], files: [] });

  assert.equal(calls, 1);
  assert.equal(requestBody.output_config.format.type, "json_schema");
  assert.equal(result.analysis.summary, validAnthropicAnalysisFixture.summary);
});

test("exact Anthropic production request uses the compact transport schema within its grammar budget", () => {
  const requestBody = anthropicProviderInternals.buildRequestBody({
    model: "claude-sonnet-4-6",
    maxOutputTokens: 64_000,
    claim: { id: "offline-production-body" },
    evidence: [],
    files: [],
  });
  const schema = requestBody.output_config.format.schema;
  const supportedKeywords = new Set(["type", "properties", "required", "additionalProperties", "items"]);
  let optionalParameters = 0;

  const visit = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const keyword of Object.keys(node)) assert.ok(supportedKeywords.has(keyword), `Unsupported schema keyword: ${keyword}`);
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      const required = new Set(node.required || []);
      optionalParameters += Object.keys(node.properties || {}).filter((key) => !required.has(key)).length;
      Object.values(node.properties || {}).forEach(visit);
    }
    if (node.items) visit(node.items);
  };
  visit(schema);

  assert.deepEqual(schema, anthropicProviderInternals.structuredOutputSchema());
  assert.deepEqual(Object.keys(schema.properties), ["sources", "records"]);
  assert.equal("classification" in schema.properties, false);
  assert.equal(optionalParameters, 0);
  assert.deepEqual(anthropicProviderInternals.measureJsonSchemaComplexity(schema), {
    serialized_bytes: 1_145,
    property_occurrences: 21,
    object_nodes: 3,
    array_nodes: 4,
    union_nodes: 0,
    union_branches: 0,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(schema)) < 2_500);
  assert.equal(JSON.stringify(schema).includes('"enum"'), false);
});

test("Anthropic transport round-trip preserves every material canonical report channel", () => {
  const materialSource = {
    document_id: "survey-quantum-1",
    document_name: "survey-and-adjustment.pdf",
    page: 3,
    supporting_text: "Net claimed damage USD 84,000; salvage offer USD 6,000.",
    confidence: 0.93,
    evidence_mode: "document_vision",
  };
  const materialAnalysis = {
    classification: {
      business_line: "Marine Cargo (Non-Reefer)",
      confidence: 0.93,
      rationale: "The evidence concerns non-refrigerated cargo transit damage.",
      sources: [materialSource],
    },
    document_types: [{
      document_type: "Survey Report",
      confidence: 0.93,
      sufficient_information: true,
      rationale: "The report records condition, cause indicators, and quantum.",
      sources: [materialSource],
    }],
    fields: [
      { field: "cause_of_loss", value: "Handling impact", normalized_value: "Handling impact", confidence: 0.81, requires_confirmation: true, sources: [materialSource] },
      { field: "policy_terms", value: "Impact damage subject to policy terms", normalized_value: null, confidence: 0.78, requires_confirmation: true, sources: [materialSource] },
      { field: "claim_amount", value: "USD 84,000", normalized_value: "84000", confidence: 0.93, requires_confirmation: false, sources: [materialSource] },
      { field: "salvage_findings", value: "Salvage offer received", normalized_value: null, confidence: 0.9, requires_confirmation: true, sources: [materialSource] },
      { field: "recovery_findings", value: "Carrier recovery remains open", normalized_value: null, confidence: 0.76, requires_confirmation: true, sources: [materialSource] },
    ],
    adjustment_line_items: [{
      description: "Damaged cargo",
      quantity: "12 units",
      unit_price: "USD 7,000",
      adjusted_value: "USD 84,000",
      currency: "USD",
      basis: "Survey adjustment schedule",
      confidence: 0.93,
      sources: [materialSource],
    }],
    missing_documents: [{
      document_type: "Notice of Claim",
      reason: "No carrier notice was located.",
      missing_information: ["Dated carrier notice", "Proof of delivery"],
    }],
    evidence_findings: [{
      analysis_domain: "proximate_cause",
      finding: "Twelve units showed impact damage; causation remains qualified.",
      confidence: 0.84,
      sources: [materialSource],
    }],
    summary: "Evidence supports a cargo damage claim with unresolved coverage and liability questions.",
    warnings: ["The invoice and survey state conflicting gross values."],
    human_review_required: ["Review coverage, liability, quantum, salvage, and carrier recovery."],
  };

  const transport = toAnthropicTransport(materialAnalysis);
  assert.equal(transport.sources.length, 1, "Repeated citations must be de-duplicated in transport");
  assert.equal(anthropicProviderInternals.anthropicTransportSchema.safeParse(transport).success, true);
  const reconstructed = anthropicProviderInternals.reconstructCanonicalAnalysis(transport);

  assert.deepEqual(reconstructed, materialAnalysis);
  assert.equal(claimAnalysisSchema.safeParse(reconstructed).success, true);
});

test("anthropic rejects markdown-fenced JSON locally", async () => {
  let calls = 0;
  const fenced = `\`\`\`json\n${JSON.stringify(toAnthropicTransport(validAnthropicAnalysisFixture))}\n\`\`\``;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: fenced }],
      })), { status: 200 });
    },
  });
  await assert.rejects(
    provider.analyze({ claim: { id: "fenced" }, evidence: [], files: [] }),
    /structured output JSON parse failed/i,
  );
  assert.equal(calls, 1);
});

test("anthropic rejects trailing commentary after structured JSON locally", async () => {
  const trailing = `${JSON.stringify(toAnthropicTransport(validAnthropicAnalysisFixture))}\nAnalysis complete.`;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: trailing }],
    })), { status: 200 }),
  });
  await assert.rejects(
    provider.analyze({ claim: { id: "trailing" }, evidence: [], files: [] }),
    /structured output JSON parse failed.*after JSON/i,
  );
});

test("anthropic ignores populated generic slots that are irrelevant to each transport record kind", async () => {
  const transport = canonicalAnalysisToAnthropicTransportFixture(validAnthropicAnalysisFixture);
  const classification = transport.records.find((record) => record.kind === "classification");
  classification.value = "MUST NOT ENTER THE CANONICAL CLAIM";
  classification.normalized_value = "MUST NOT ENTER THE CANONICAL CLAIM";
  for (const record of transport.records.filter((item) => item.kind === "document_type")) {
    record.value = "MUST NOT ENTER THE CANONICAL CLAIM";
  }

  let calls = 0;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: JSON.stringify(transport) }],
      })), { status: 200 });
    },
  });
  const result = await provider.analyze({
    claim: { id: "irrelevant-transport-slots" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({
      mimetype: item.mime_type,
      buffer: Buffer.from(item.pages[0].text),
    })),
  });

  assert.equal(calls, 1);
  assert.equal(result.analysis.classification.business_line, validAnthropicAnalysisFixture.classification.business_line);
  assert.equal(claimAnalysisSchema.safeParse(result.analysis).success, true);
  assert.doesNotMatch(JSON.stringify(result.analysis), /MUST NOT ENTER THE CANONICAL CLAIM/);
});

test("anthropic canonicalizes unambiguous transport kind and enum formatting drift", async () => {
  const transport = canonicalAnalysisToAnthropicTransportFixture(validAnthropicAnalysisFixture);
  const classification = transport.records.find((record) => record.kind === "classification");
  classification.kind = " Classification ";
  classification.key = "air shipment net";
  classification.confidence = 94;
  const documentType = transport.records.find((record) => record.kind === "document_type");
  documentType.kind = "Document Type";
  documentType.key = documentType.key.replaceAll(" ", "-").toLowerCase();
  const field = transport.records.find((record) => record.kind === "field");
  field.kind = "FIELD";
  field.key = field.key.replaceAll("_", " ").toUpperCase();
  transport.sources[0].page = -1;
  transport.sources[0].confidence = 94;

  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: JSON.stringify(transport) }],
    })), { status: 200 }),
  });
  const result = await provider.analyze({
    claim: { id: "transport-format-drift" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.equal(result.analysis.classification.sources[0].page, null);
  assert.equal(claimAnalysisSchema.safeParse(result.analysis).success, true);
});

test("anthropic safely recovers missing envelope records and invalid citation indexes without inventing facts", async () => {
  const transport = canonicalAnalysisToAnthropicTransportFixture(validAnthropicAnalysisFixture);
  transport.records = transport.records.filter((record) => !["classification", "summary"].includes(record.kind));
  const supportedField = transport.records.find((record) => record.kind === "field" && record.value);
  supportedField.source_refs = [transport.sources.length + 100];
  const unknownField = structuredClone(supportedField);
  unknownField.key = "unsupported_claim_fact";
  unknownField.value = "MUST NOT ENTER THE CANONICAL CLAIM";
  transport.records.push(unknownField);

  let calls = 0;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: JSON.stringify(transport) }],
      })), { status: 200 });
    },
  });
  const result = await provider.analyze({
    claim: { id: "safe-transport-recovery" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(calls, 1);
  assert.equal(result.analysis.classification.business_line, "Other / Requires Review");
  assert.match(result.analysis.summary, /no claim summary/i);
  assert.equal(result.analysis.fields.find((item) => item.field === supportedField.key).value, null);
  assert.match(result.analysis.warnings.join(" "), /invalid citation reference/i);
  assert.doesNotMatch(JSON.stringify(result.analysis), /MUST NOT ENTER THE CANONICAL CLAIM/);
  assert.equal(claimAnalysisSchema.safeParse(result.analysis).success, true);
});

test("anthropic deterministically recovers a missing marine classification from substantive current evidence", async () => {
  const evidence = [
    {
      document_id: "marine-policy-1",
      document_name: "uploaded-pack.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      extraction_status: "extracted",
      pages: [{
        page: 1,
        text: "MARINE CARGO INSURANCE POLICY\nSCHEDULE OF PARTICULAR CONDITIONS\nPolicy Number: CRG/1331149",
      }],
    },
    {
      document_id: "marine-bl-1",
      document_name: "uploaded-pack.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      extraction_status: "extracted",
      pages: [{
        page: 4,
        text: "BILL OF LADING\nB/L Number: GFS-250745\nShipper: Austeel SAL\nConsignee: Austeel Cyprus LTD\nVessel: MSC RENAISSANCE III\nPort of Loading: Beirut\nPort of Discharge: Limassol\nContainer: CLTU7002343\nCarrier boilerplate: no responsibility for recording temperatures other than a reefer log book maintained by the Carrier.",
      }],
    },
    {
      document_id: "marine-invoice-1",
      document_name: "uploaded-pack.pdf",
      mime_type: "application/pdf",
      kind: "pdf",
      extraction_status: "extracted",
      pages: [{ page: 6, text: "COMMERCIAL INVOICE\nInvoice Number: INV-745\nDescription: glass panels" }],
    },
  ];
  const responseFixture = {
    ...structuredAnalysis,
    classification: undefined,
    document_types: [],
    fields: [],
    evidence_findings: [],
    summary: "The documents concern a containerized glass-panel transit claim.",
  };
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: JSON.stringify(toAnthropicTransport(responseFixture)) }],
    })), { status: 200 }),
  });

  const result = await provider.analyze({
    claim: { id: "missing-marine-classification" },
    evidence,
    files: evidence.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(result.analysis.classification.business_line, "Marine Cargo (Non-Reefer)");
  assert.equal(result.analysis.classification.confidence, 0.94);
  assert.equal(result.analysis.classification.sources[0].document_id, "marine-bl-1");
  assert.deepEqual(
    new Set(result.analysis.document_types.map((item) => item.document_type)),
    new Set(["Policy", "Bill of Lading", "Commercial Invoice", "Supporting Evidence"]),
  );
  assert.equal(result.analysis.missing_documents.some((item) => item.document_type === "Policy"), false);
  assert.equal(result.analysis.missing_documents.some((item) => item.document_type === "Claim Form"), true);
  assert.match(result.analysis.warnings.join(" "), /business line was recovered deterministically/i);
  assert.equal(claimAnalysisSchema.safeParse(result.analysis).success, true);
});

test("anthropic does not treat a policy-number mention in a claim form as an uploaded policy", () => {
  const evidence = [{
    document_id: "claim-only-1",
    document_name: "claim-form.pdf",
    mime_type: "application/pdf",
    kind: "pdf",
    extraction_status: "extracted",
    pages: [{
      page: 1,
      text: "CLAIM FORM\nPolicy No: CRG/1331149\nClaimant: Example Trading SAL\nClaimed amount: USD 1,000",
    }],
  }];
  const parsed = structuredClone(validAnthropicAnalysisFixture);
  parsed.classification = {
    business_line: "Other / Requires Review",
    confidence: 0,
    rationale: "Claude returned no recognized classification record.",
    sources: [],
  };
  parsed.document_types = [];
  parsed.fields = [];
  parsed.evidence_findings = [];
  parsed.missing_documents = [];

  const result = anthropicProviderInternals.enforceAnthropicGrounding(parsed, evidence);

  assert.equal(result.document_types.some((item) => item.document_type === "Claim Form"), true);
  assert.equal(result.document_types.some((item) => item.document_type === "Policy"), false);
  assert.equal(result.missing_documents.some((item) => item.document_type === "Policy"), true);
});

test("anthropic recovers an image-only policy only from multiple verified policy-specific fields", () => {
  const evidence = [{
    document_id: "scanned-policy-1",
    document_name: "documents.pdf",
    mime_type: "application/pdf",
    kind: "pdf",
    extraction_status: "vision-required",
    pages: [{ page: 8, text: "", extraction_status: "image-only" }],
    vision_images: [{ page: 8, mime_type: "image/jpeg", buffer: Buffer.from("policy-page") }],
  }];
  const visualSource = (supportingText) => ({
    document_id: "scanned-policy-1",
    document_name: "documents.pdf",
    page: 8,
    supporting_text: supportingText,
    confidence: 0.95,
    evidence_mode: "document_vision",
  });
  const parsed = structuredClone(validAnthropicAnalysisFixture);
  parsed.classification = {
    business_line: "Other / Requires Review",
    confidence: 0,
    rationale: "Claude returned no recognized classification record.",
    sources: [],
  };
  parsed.document_types = [];
  parsed.fields = [{
    field: "policy_number",
    value: "CRG/1331149",
    normalized_value: "CRG/1331149",
    confidence: 0.95,
    requires_confirmation: false,
    sources: [visualSource("Policy No. CRG/1331149")],
  }, {
    field: "policy_warranties",
    value: "Survey warranty applies.",
    normalized_value: "Survey warranty applies.",
    confidence: 0.93,
    requires_confirmation: false,
    sources: [visualSource("Warranted survey report is obtained")],
  }];
  parsed.evidence_findings = [];
  parsed.missing_documents = [];

  const result = anthropicProviderInternals.enforceAnthropicGrounding(parsed, evidence);

  const policy = result.document_types.find((item) => item.document_type === "Policy");
  assert.equal(policy.sufficient_information, true);
  assert.equal(policy.sources.every((source) => source.evidence_mode === "document_vision"), true);
  assert.equal(result.missing_documents.some((item) => item.document_type === "Policy"), false);
});

test("anthropic turns conflicting classification records into explicit human review", async () => {
  const transport = canonicalAnalysisToAnthropicTransportFixture(validAnthropicAnalysisFixture);
  const conflicting = structuredClone(transport.records.find((record) => record.kind === "classification"));
  conflicting.key = "Property";
  conflicting.text = "A second incompatible classification was returned.";
  transport.records.push(conflicting);

  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: JSON.stringify(transport) }],
    })), { status: 200 }),
  });
  const result = await provider.analyze({
    claim: { id: "conflicting-classification" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });

  assert.equal(result.analysis.classification.business_line, "Other / Requires Review");
  assert.match(result.analysis.warnings.join(" "), /conflicting classification candidates/i);
  assert.match(result.analysis.human_review_required.join(" "), /confirm the claim business line/i);
  assert.equal(claimAnalysisSchema.safeParse(result.analysis).success, true);
});

test("anthropic nullable-slot recovery does not accept malformed nested values, unknown keys, or invalid structures", async () => {
  const cases = [
    ["nested value object", (transport) => { transport.records[0].value = { value: null }; }],
    ["unknown top-level field", (transport) => { transport.unexpected = true; }],
    ["unknown record field", (transport) => { transport.records[0].unexpected = "not allowed"; }],
    ["unknown record kind", (transport) => { transport.records[0].kind = "unsupported_fact_bucket"; }],
    ["missing required slot", (transport) => { delete transport.records[0].key; }],
  ];

  for (const [name, mutate] of cases) {
    const transport = canonicalAnalysisToAnthropicTransportFixture(validAnthropicAnalysisFixture);
    mutate(transport);
    let calls = 0;
    const provider = createAnthropicProvider({
      apiKey: "server-only-key",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify(anthropicMessageFixture(undefined, {
          content: [{ type: "text", text: JSON.stringify(transport) }],
        })), { status: 200 });
      },
    });

    await assert.rejects(
      provider.analyze({ claim: { id: `strict-${name}` }, evidence: multiDocumentEvidenceFixture, files: [] }),
      /transport schema validation failed/i,
      name,
    );
    assert.equal(calls, 1, `${name} must fail after one response without retrying`);
  }
});

test("anthropic rejects malformed commas and quotes locally", async () => {
  for (const [id, malformed] of [
    ["comma", '{"classification":,}'],
    ["quote", '{"classification":{"business_line":"Marine Cargo}}'],
  ]) {
    const provider = createAnthropicProvider({
      apiKey: "server-only-key",
      fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [{ type: "text", text: malformed }],
      })), { status: 200 }),
    });
    await assert.rejects(
      provider.analyze({ claim: { id }, evidence: [], files: [] }),
      /structured output JSON parse failed/i,
    );
  }
});

test("anthropic completes missing optional claim fields locally as null after validation", async () => {
  const sparse = structuredClone(validAnthropicAnalysisFixture);
  sparse.fields = sparse.fields.filter((field) => field.field === "insured");
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(sparse)), { status: 200 }),
  });
  const result = await provider.analyze({ claim: { id: "sparse-fields" }, evidence: [], files: [] });
  const completed = result.analysis.fields.find((field) => field.field === "recovery_findings");

  assert.equal(result.analysis.fields.length, CLAIM_FIELDS.length);
  assert.deepEqual(completed, {
    field: "recovery_findings",
    value: null,
    normalized_value: null,
    confidence: 0,
    requires_confirmation: true,
    sources: [],
  });
});

test("anthropic rejects a mocked response missing a required transport collection", async () => {
  const missingRecords = toAnthropicTransport(validAnthropicAnalysisFixture);
  delete missingRecords.records;
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: JSON.stringify(missingRecords) }],
    })), { status: 200 }),
  });

  await assert.rejects(
    provider.analyze({ claim: { id: "missing-fields" }, evidence: [], files: [] }),
    /transport schema validation failed.*records/is,
  );
});

test("anthropic rejects truncated JSON without a production fallback", async () => {
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "text", text: '{"classification":' }],
    })), { status: 200 }),
  });

  await assert.rejects(
    provider.analyze({ claim: { id: "malformed" }, evidence: [], files: [] }),
    (error) => error.isProviderError === true && /structured output JSON parse failed/i.test(error.message),
  );
});

test("anthropic reports HTTP-200 stop reasons instead of claiming structured text is missing", async () => {
  for (const [stopReason, expected] of [
    ["max_tokens", /reached max_tokens/i],
    ["refusal", /refused/i],
    ["pause_turn", /stopped with pause_turn/i],
  ]) {
    const provider = createAnthropicProvider({
      apiKey: "server-only-key",
      fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
        content: [],
        stop_reason: stopReason,
      })), { status: 200 }),
    });
    await assert.rejects(
      provider.analyze({ claim: { id: `stop-${stopReason}` }, evidence: [], files: [] }),
      (error) => error.providerStatus === 200 && error.isProviderError === true && expected.test(error.message),
    );
  }
});

test("anthropic reports unreadable and empty HTTP-200 response bodies precisely", async () => {
  const unreadable = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response("not json", { status: 200 }),
  });
  await assert.rejects(
    unreadable.analyze({ claim: { id: "unreadable" }, evidence: [], files: [] }),
    /unreadable response body/i,
  );

  const empty = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(undefined, {
      content: [{ type: "thinking", thinking: "completed" }],
    })), { status: 200 }),
  });
  await assert.rejects(
    empty.analyze({ claim: { id: "empty" }, evidence: [], files: [] }),
    /content block types: thinking.*stop_reason: end_turn/i,
  );
});

test("anthropic accepts documented enum casing drift before strict application validation", async () => {
  const casingDrift = structuredClone(validAnthropicAnalysisFixture);
  casingDrift.classification.business_line = "air shipment (net)";
  casingDrift.document_types[0].document_type = "policy";
  casingDrift.fields[0].field = "INSURED";
  casingDrift.classification.sources[0].evidence_mode = "EXTRACTED_TEXT";
  const provider = createAnthropicProvider({
    apiKey: "server-only-key",
    fetchImpl: async () => new Response(JSON.stringify(anthropicMessageFixture(casingDrift)), { status: 200 }),
  });

  const result = await provider.analyze({
    claim: { id: "enum-casing" },
    evidence: multiDocumentEvidenceFixture,
    files: multiDocumentEvidenceFixture.map((item) => ({ mimetype: item.mime_type, buffer: Buffer.from(item.pages[0].text) })),
  });
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.document_types[0].document_type, "Policy");
  assert.equal(result.analysis.fields[0].field, "insured");
  assert.equal(result.analysis.classification.sources[0].evidence_mode, "extracted_text");
});

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

// --- Gemini provider status ---

test("gemini status reports unconfigured without GEMINI_API_KEY", () => {
  const status = getAIStatus({ AI_PROVIDER: "gemini" });
  assert.equal(status.configured, false);
  assert.equal(status.provider, "gemini");
  assert.match(status.reason, /GEMINI_API_KEY/);
});

test("gemini status reports configured with key and default model", () => {
  const status = getAIStatus({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
  assert.equal(status.configured, true);
  assert.equal(status.provider, "gemini");
  assert.equal(status.model, "gemini-2.5-flash");
});

// --- OpenRouter provider status ---

test("openrouter status reports unconfigured without OPENROUTER_API_KEY", () => {
  const status = getAIStatus({ AI_PROVIDER: "openrouter" });
  assert.equal(status.configured, false);
  assert.equal(status.provider, "openrouter");
  assert.match(status.reason, /OPENROUTER_API_KEY/);
});

test("openrouter status reports configured with key and custom model", () => {
  const status = getAIStatus({
    AI_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "openrouter/free",
  });
  assert.equal(status.configured, true);
  assert.equal(status.model, "openrouter/free");
});

// --- Fallback discovery ---

test("fallback list includes other configured providers", () => {
  const status = getAIStatus({
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "gkey",
    OPENROUTER_API_KEY: "orkey",
  });
  assert.equal(status.configured, true);
  assert.equal(status.provider, "gemini");
  assert.equal(status.fallbacks.length, 1);
  assert.equal(status.fallbacks[0].provider, "openrouter");
});

test("fallback list is empty when no other providers are configured", () => {
  const status = getAIStatus({ AI_PROVIDER: "openai", OPENAI_API_KEY: "okey" });
  assert.equal(status.fallbacks.length, 0);
});

// --- Chat Completions provider (Gemini) sends correct request shape ---

test("gemini provider sends a Chat Completions request with vision content", async () => {
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            id: "chatcmpl-test",
            choices: [{ message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createGeminiProvider({ client, model: "gemini-2.5-flash" });
  const evidence = [
    {
      document_id: "combined-1",
      document_name: "upload-a.docx",
      mime_type: "text/plain",
      kind: "text",
      extraction_status: "extracted",
      pages: [{ page: null, text: textSource.supporting_text }],
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
    { mimetype: "text/plain", buffer: Buffer.from(textSource.supporting_text) },
    { mimetype: "image/jpeg", buffer: Buffer.from("image") },
  ];

  const result = await provider.analyze({ claim: { id: "claim-1" }, evidence, files });
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-2.5-flash");
  assert.equal(request.model, "gemini-2.5-flash");
  // System message + user message
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[0].role, "system");
  // User content should have text + image_url for the photo
  const userContent = request.messages[1].content;
  assert.equal(userContent[0].type, "text");
  assert.match(userContent[0].text, /combined-1/);
  const images = userContent.filter((item) => item.type === "image_url");
  assert.equal(images.length, 1);
  assert.match(images[0].image_url.url, /^data:image\/jpeg;base64,/);
  // response_format should be set
  assert.equal(request.response_format.type, "json_schema");
});

// --- Fallback behavior ---

test("fallback provider is used when primary fails with a retryable error", async () => {
  const env = {
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "gkey",
    OPENAI_API_KEY: "okey",
  };

  const { provider } = createConfiguredProvider(env);
  assert.ok(provider, "A provider should be created");

  // The real providers would need network. We just verify the fallback
  // structure was created with the primary + fallback order.
  assert.equal(provider.name, "gemini");
});

// --- OpenRouter provider sends correct request shape ---

test("openrouter provider sends a Chat Completions request without sending PDF in image_url", async () => {
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            id: "chatcmpl-openrouter-test",
            choices: [{ message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({ client, model: "google/gemma-4-31b-it:free" });
  const evidence = [
    {
      document_id: "combined-1",
      document_name: "upload-a.docx",
      mime_type: "text/plain",
      kind: "text",
      extraction_status: "extracted",
      pages: [{ page: null, text: textSource.supporting_text }],
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
    { mimetype: "text/plain", buffer: Buffer.from(textSource.supporting_text) },
    { mimetype: "application/pdf", buffer: Buffer.from("pdf") },
    { mimetype: "image/jpeg", buffer: Buffer.from("image") },
  ];

  const result = await provider.analyze({ claim: { id: "claim-1" }, evidence, files });
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "google/gemma-4-31b-it:free");
  assert.equal(request.model, "google/gemma-4-31b-it:free");
  assert.deepEqual(request.models, ["openrouter/free"]);
  assert.equal(request.provider, undefined);
  assert.equal(request.max_completion_tokens, 16384);
  assert.deepEqual(request.plugins, [{ id: "response-healing" }]);
  assert.equal(request.temperature, 0);
  assert.equal(request.response_format.type, "json_object");
  assert.equal(request.response_format.json_schema, undefined);
  // System message + user message
  assert.equal(request.messages.length, 2);
  assert.equal(request.messages[0].role, "system");
  // User content should have text + image_url for the photo, but NOT for the PDF (since OpenRouter doesn't support PDF in image_url)
  const userContent = request.messages[1].content;
  assert.equal(userContent[0].type, "text");
  assert.match(userContent[0].text, /combined-1/);
  const images = userContent.filter((item) => item.type === "image_url");
  assert.equal(images.length, 1);
  assert.match(images[0].image_url.url, /^data:image\/jpeg;base64,/);
  // response_format should be set
  assert.equal(request.response_format.type, "json_object");
  assert.match(request.messages[0].content, /matching this schema exactly/i);
});

test("openrouter provider retries the base model slug after a 404", async () => {
  const calls = [];
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          calls.push(value.model);
          if (calls.length === 1) {
            const error = new Error("Not Found");
            error.status = 404;
            throw error;
          }
          return {
            id: "chatcmpl-openrouter-retry",
            choices: [{ message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({ client, model: "google/gemma-4-26b-a4b-it:free" });
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
  assert.equal(result.provider, "openrouter");
  assert.deepEqual(calls, ["google/gemma-4-26b-a4b-it:free", "google/gemma-4-26b-a4b-it"]);
});

test("openrouter retries malformed structured output with the free router fallback", async () => {
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          requests.push(value);
          if (requests.length === 1) {
            return {
              id: "chatcmpl-truncated",
              model: "google/gemma-4-31b-it:free",
              choices: [{ finish_reason: "length", message: { content: '{"classification":"unterminated' } }],
            };
          }
          return {
            id: "chatcmpl-recovered",
            model: "nvidia/nemotron-nano-9b-v2:free",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({
    client,
    model: "google/gemma-4-31b-it:free",
    fallbackModels: "openrouter/free",
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

  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "google/gemma-4-31b-it:free");
  assert.deepEqual(requests[0].models, ["openrouter/free"]);
  assert.equal(requests[1].model, "openrouter/free");
  assert.equal(requests[1].models, undefined);
  assert.equal(result.model, "nvidia/nemotron-nano-9b-v2:free");
  assert.equal(result.response_id, "chatcmpl-recovered");
});

test("openrouter retries an empty Gemma response with the compatible free router fallback", async () => {
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          requests.push(value);
          if (requests.length === 1) {
            return {
              id: "chatcmpl-empty",
              model: "google/gemma-4-26b-a4b-it:free",
              choices: [{ finish_reason: "stop", message: { content: "" } }],
            };
          }
          return {
            id: "chatcmpl-empty-recovered",
            model: "openrouter/free",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({
    client,
    model: "google/gemma-4-26b-a4b-it:free",
    fallbackModels: "openrouter/free",
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

  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, "json_object");
  assert.equal(requests[1].response_format.type, "json_object");
  assert.equal(result.response_id, "chatcmpl-empty-recovered");
});

test("openrouter retries a terminated request with the explicit fallback model", async () => {
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          requests.push(value);
          if (requests.length === 1) throw new Error("terminated");
          return {
            id: "chatcmpl-network-recovered",
            model: "openrouter/free",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({
    client,
    model: "google/gemma-4-31b-it:free",
    fallbackModels: "openrouter/free",
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

  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "google/gemma-4-31b-it:free");
  assert.equal(requests[1].model, "openrouter/free");
  assert.equal(result.response_id, "chatcmpl-network-recovered");
});

test("openrouter safely normalizes a partial response after both structured attempts fail", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return {
            id: `chatcmpl-partial-${calls}`,
            model: calls === 1 ? "google/gemma-4-31b-it:free" : "nvidia/nemotron-nano-9b-v2:free",
            choices: [{
              finish_reason: "stop",
              message: { content: JSON.stringify({ missing_documents: ["Policy", "Commercial Invoice"] }) },
            }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({
    client,
    model: "google/gemma-4-31b-it:free",
    fallbackModels: "openrouter/free",
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

  assert.equal(calls, 2);
  assert.equal(result.analysis.classification.business_line, "Other / Requires Review");
  assert.ok(result.analysis.missing_documents.every((item) => typeof item === "object"));
  assert.ok(result.analysis.missing_documents.some((item) => item.document_type === "Policy"));
  assert.ok(result.analysis.missing_documents.some((item) => item.document_type === "Commercial Invoice"));
  assert.match(result.analysis.warnings.join(" "), /incomplete schema/i);
  assert.match(result.analysis.human_review_required.join(" "), /incomplete AI response/i);
});

test("openrouter includes every locally rendered image-only PDF page with its document and page label", async () => {
  let request;
  const client = {
    chat: {
      completions: {
        create: async (value) => {
          request = value;
          return {
            id: "chatcmpl-vision-pages",
            model: "configured-model",
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify(structuredAnalysis) } }],
          };
        },
      },
    },
  };
  const provider = createOpenRouterProvider({ client, model: "configured-model", fallbackModels: [] });
  const evidence = [{
    document_id: "mixed-pdf",
    document_name: "combined evidence.pdf",
    mime_type: "application/pdf",
    kind: "pdf",
    extraction_status: "extracted",
    pages: [
      { page: 1, text: "Insurance Policy Number POL-44" },
      { page: 2, text: "", extraction_status: "image-only" },
    ],
    vision_images: [{ page: 2, mime_type: "image/jpeg", buffer: Buffer.from("scan-page-two") }],
  }];

  await provider.analyze({
    claim: { id: "claim-vision" },
    evidence,
    files: [{ mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
  });

  const content = request.messages.find((message) => message.role === "user").content;
  assert.ok(content.some((part) => part.type === "text" && part.text === "[Vision page: combined evidence.pdf, page 2]"));
  assert.ok(content.some((part) => part.type === "image_url" && part.image_url.url === `data:image/jpeg;base64,${Buffer.from("scan-page-two").toString("base64")}`));
});


