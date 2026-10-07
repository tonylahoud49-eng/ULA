import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jsPDF } from "jspdf";
import { createAnalysisJobStore } from "../ai/analysisJobStore.mjs";
import { createAnalysisJobs, mergeJobEvidence, verifyReviewedSourcePages, describeAnalysisFailure } from "../ai/analysisJobs.mjs";
import { createAnalysisChat } from "../ai/analysisChat.mjs";
import { createAnthropicProvider } from "../ai/providers/anthropicProvider.mjs";
import { anthropicMessageFixture, multiDocumentEvidenceFixture, validAnthropicAnalysisFixture } from "./fixtures/anthropicResponses.mjs";
import { extractEvidenceFile, inspectPdf } from "../evidence/extractEvidence.mjs";
import { evidenceForDraft, assertReportCanBeIssued } from "../../src/lib/reportEvidenceGate.js";

const analysis = () => ({ classification: { business_line: "Other / Requires Review", confidence: 0, rationale: "Requires review", sources: [] }, summary: "Provisional review.", fields: [], document_types: [], evidence_findings: [], adjustment_line_items: [], missing_documents: [], warnings: [], human_review_required: [] });
const response = () => ({ provider: "anthropic", model: "claude-sonnet-4-6", analysis: analysis(), usage: { input_tokens: 100, output_tokens: 50, estimated_cost_usd: 0.001 }, analyzed_at: new Date().toISOString() });
const request = () => ({ claim: { id: "claim-1", title: "Test claim" }, owner: "user-1", model: "claude-sonnet-4-6", manifest: [{ id: "doc-1", file_name: "bundle.pdf" }], files: [{ originalname: "bundle.pdf", mimetype: "application/pdf", size: 4, buffer: Buffer.from("test") }] });
const fakeExtract = async (file, metadata) => ({ document_id: metadata.id, document_name: file.originalname, kind: "pdf", mime_type: "application/pdf", extraction_status: "extracted", pages: Array.from({ length: metadata.page_range.end - metadata.page_range.start + 1 }, (_, index) => ({ page: metadata.page_range.start + index, text: `Evidence on page ${metadata.page_range.start + index}.` })), vision_images: [] });
const measure = ({ evidence, analysisContext }) => ({ fits: analysisContext?.startsWith("WHOLE-CLAIM") || evidence.reduce((sum, item) => sum + item.pages.length, 0) <= 20 });
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-analysis-jobs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createAnalysisJobStore(directory);
  const factory = (overrides = {}) => createAnalysisJobs({ store, providerFactory: () => ({ analyze: async () => response() }), getStyleReferences: async () => [], inspect: async () => ({ page_count: 180 }), extract: fakeExtract, measure, env: {}, ...options, ...overrides });
  return { store, factory, jobs: factory() };
}

test("180-page analysis saves ordered batches, reconciles once and reuses results", async (t) => {
  const calls = [];
  const { jobs } = fixture(t, { providerFactory: () => ({ analyze: async (params) => { calls.push(params); return response(); } }) });
  const submitted = await jobs.create(request());
  await jobs.idle();
  const job = jobs.get(submitted.id, "user-1");
  assert.equal(job.state, "complete");
  assert.equal(job.reviewed_pages, 180);
  assert.equal(job.completed_batches, 9);
  assert.equal(calls.length, 10);
  assert.equal(calls[8].evidence[0].pages[0].page, 161);
  assert.match(calls[9].analysisContext, /WHOLE-CLAIM/);
  assert.equal(jobs.result(job.id, "user-1").evidence_snapshot[0].pages.length, 180);
  assert.equal(jobs.result(job.id, "user-1").usage.input_tokens, 1000);
  assert.equal((await jobs.create(request())).id, job.id);
  jobs.resume(job.id, "user-1"); await jobs.idle();
  assert.equal(calls.length, 10);
  assert.throws(() => jobs.get(job.id, "other-user"), /not found/);
  assert.throws(() => jobs.get("../../secret", "user-1"), /not found/);
});

test("approved methodology is snapshotted with jobs, recorded in results and invalidates new-job identity", async (t) => {
  const core = { profile_id: "property-fire", source_role: "style_reference_only", applies_to: { business_lines: ["Property"], evidence_terms_any: ["insured premises"] }, style_notes: ["Test supported facts."] };
  const brain = { profile_id: "brain-test", brain_report_id: "a".repeat(64), approved: true, is_brain_knowledge: true, revision: 1, title: "Approved Property methodology", source_role: "style_reference_only", applies_to: { business_lines: ["Property"], evidence_terms_any: ["water"] }, style_notes: ["Trace water entry against observed damage."] };
  let active = [core, brain], calls = 0;
  const { jobs, store } = fixture(t, {
    getStyleReferences: async () => active,
    inspect: async () => ({ page_count: 1 }),
    extract: async (file, metadata) => ({ ...(await fakeExtract(file, metadata)), pages: [{ page: 1, text: "Water damage at insured premises." }] }),
    providerFactory: () => ({ analyze: async () => { calls++; return response(); } }),
  });
  const input = request(); input.claim.business_line = "Property";
  const first = await jobs.create(input); await jobs.idle();
  assert.equal(jobs.result(first.id, input.owner).methodology_references[0].revision, 1);
  assert.equal((await jobs.create(input)).id, first.id); assert.equal(calls, 1);
  active = [core, { ...brain, revision: 2 }];
  const changed = await jobs.create(input); await jobs.idle();
  assert.notEqual(changed.id, first.id); assert.equal(calls, 2);
  active = [core];
  const removed = await jobs.create(input); await jobs.idle();
  assert.deepEqual(jobs.result(removed.id, input.owner).methodology_references, []);
  assert.equal(store.read(first.id, "input").styleReferences[1].revision, 1);
  jobs.resume(first.id, input.owner); await jobs.idle(); assert.equal(calls, 3);
});

test("40 pages get multiple checkpoints even when the provider request budget fits", async (t) => {
  let finishFirst, firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const calls = [];
  const { jobs, store } = fixture(t, {
    inspect: async () => ({ page_count: 40 }), measure: () => ({ fits: true }),
    env: { AI_JOB_REQUEST_TIMEOUT_MS: 900_000 },
    providerFactory: () => ({ analyze: async (params) => {
      calls.push(params);
      assert.equal(params.requestTimeoutMs, 300_000, "configured timeouts cannot exceed the five-minute per-attempt cap");
      if (calls.length === 1) {
        params.onProgress({ stage: "receiving", received_bytes: 42, private_text: "must never be persisted" });
        firstStarted(); await first;
      }
      return response();
    } }),
  });
  const submitted = await jobs.create(request());
  await started;
  const running = jobs.get(submitted.id, "user-1");
  assert.equal(running.total_batches, 2);
  assert.equal(running.reviewed_pages, 0);
  assert.equal(running.request_progress.stage, "receiving");
  assert.equal(running.request_progress.received_bytes, 42);
  assert.ok(running.request_progress.last_activity_at);
  assert.doesNotMatch(JSON.stringify(store.read(submitted.id)), /private_text|must never/);
  finishFirst(); await jobs.idle();
  assert.equal(calls.length, 3);
  assert.equal(jobs.get(submitted.id, "user-1").reviewed_pages, 40);
  assert.equal(jobs.get(submitted.id, "user-1").request_progress, null);
});

test("resume subdivides an oversized unfinished batch saved by an older release", async (t) => {
  const { jobs, store, factory } = fixture(t, {
    inspect: async () => ({ page_count: 40 }), measure: () => ({ fits: true }),
    providerFactory: () => ({ analyze: async () => { throw new Error("Unavailable"); } }),
  });
  const submitted = await jobs.create(request()); await jobs.idle();
  const record = store.read(submitted.id);
  record.batches = [{ id: "old", indexes: [0, 1], state: "pending", page_count: 40 }];
  store.write(submitted.id, "job", record);
  const reviews = [];
  const resumed = factory({ providerFactory: () => ({ analyze: async (params) => { if (!params.requestEvidence) reviews.push(params.evidence); return response(); } }) });
  resumed.resume(submitted.id, "user-1"); await resumed.idle();
  assert.deepEqual(reviews.map((evidence) => evidence[0].pages.length), [20, 20]);
  assert.deepEqual(reviews.flatMap((evidence) => evidence[0].pages.map((page) => page.page)), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.equal(resumed.get(submitted.id, "user-1").state, "complete");
});

test("image failure persists completed batches; provisional draft blocks final; restart resumes only unfinished work", async (t) => {
  let fail = true;
  const calls = [];
  const providerFactory = () => ({ analyze: async (params) => {
    calls.push(params);
    if (!params.requestEvidence && fail && params.evidence.some((item) => item.pages.some((page) => page.page === 41))) throw new Error("Unable to decode image [image_request_error]");
    return response();
  } });
  const { jobs, factory } = fixture(t, { providerFactory });
  const submitted = await jobs.create(request()); await jobs.idle();
  const failed = jobs.get(submitted.id, "user-1");
  assert.equal(failed.state, "failed");
  assert.equal(failed.reviewed_pages, 40);
  assert.equal(failed.error.code, "image-review-failed");
  assert.deepEqual(failed.error.affected[0].pages, [41]);
  const beforeProvisional = calls.length;
  const partial = await jobs.provisional(submitted.id, "user-1");
  assert.equal(calls.length, beforeProvisional + 1);
  assert.equal(partial.provisional, true);
  assert.equal(partial.evidence_snapshot[0].extraction_status, "partial");
  assert.equal(partial.evidence_snapshot[0].pages.length, 40);
  assert.deepEqual(partial.evidence_snapshot[0].unreviewed_pages, Array.from({ length: 140 }, (_, index) => index + 41));
  const mapped = { ...partial, status: "completed" };
  const draftEvidence = evidenceForDraft(mapped, [{ id: "doc-1", file_name: "bundle.pdf" }]);
  const report = { issue_state: "draft", normalized_claim_record: { evidence: draftEvidence } };
  assert.doesNotThrow(() => assertReportCanBeIssued(report));
  assert.throws(() => assertReportCanBeIssued({ ...report, issue_state: "final" }), /unreviewed pages/);
  assert.throws(() => assertReportCanBeIssued({ ...report, status: "approved" }), /unreviewed pages/);
  assert.deepEqual(await jobs.provisional(submitted.id, "user-1"), partial);
  assert.equal(calls.length, beforeProvisional + 1);
  fail = false;
  const restarted = factory();
  restarted.resume(submitted.id, "user-1"); await restarted.idle();
  assert.equal(restarted.get(submitted.id, "user-1").state, "complete");
  assert.equal(restarted.get(submitted.id, "user-1").reviewed_pages, 180);
  assert.equal(calls.filter((params) => !params.requestEvidence && params.evidence[0].pages[0].page === 1).length, 1);
  assert.equal(restarted.result(submitted.id, "user-1").evidence_snapshot[0].pages.length, 180);
  assert.throws(() => assertReportCanBeIssued({ ...report, status: "final" }), /unreviewed pages/);
});

test("dead-worker recovery preserves artifacts and synthesis failure does not repeat batch calls", async (t) => {
  let rejectSynthesis = true, reviews = 0;
  const { jobs, factory, store } = fixture(t, { providerFactory: () => ({ analyze: async (params) => {
    if (params.requestEvidence && rejectSynthesis) throw new Error("Reconciliation unavailable");
    if (!params.requestEvidence) reviews += 1;
    return response();
  } }) });
  const submitted = await jobs.create(request()); await jobs.idle();
  assert.equal(jobs.get(submitted.id, "user-1").state, "failed");
  const record = store.read(submitted.id);
  record.state = "running"; store.write(record.id, "job", record);
  const restarted = factory();
  assert.equal(restarted.get(submitted.id, "user-1").state, "interrupted");
  rejectSynthesis = false;
  restarted.resume(submitted.id, "user-1"); await restarted.idle();
  assert.equal(reviews, 9);
  assert.equal(restarted.get(submitted.id, "user-1").state, "complete");
  const obsolete = store.read(submitted.id);
  obsolete.pipeline_version = "obsolete"; store.write(submitted.id, "job", obsolete);
  assert.throws(() => restarted.resume(submitted.id, "user-1"), /different analysis pipeline/);
});

test("bounded retries save successful batches and duplicate submissions cannot run twice", async (t) => {
  let attempts = 0;
  const delays = [];
  const { jobs } = fixture(t, { inspect: async () => ({ page_count: 1 }), sleep: async (ms) => { if (ms >= 1000) delays.push(ms); else await new Promise((resolve) => setTimeout(resolve, 1)); }, providerFactory: () => ({ analyze: async () => { attempts += 1; if (attempts < 3) throw Object.assign(new Error("Rate limited"), { status: 429 }); return response(); } }) });
  const [first, second] = await Promise.all([jobs.create(request()), jobs.create(request())]);
  assert.equal(first.id, second.id); await jobs.idle();
  assert.equal(attempts, 3); assert.deepEqual(delays, [2000, 4000]);
  const changed = request(); changed.files[0].buffer = Buffer.from("new evidence");
  assert.notEqual((await jobs.create(changed)).id, first.id); await jobs.idle();
});

test("empty partial review and unreviewed citations cannot become a draft", async (t) => {
  const { jobs } = fixture(t, { providerFactory: () => ({ analyze: async () => { throw new Error("Unavailable"); } }) });
  const job = await jobs.create(request()); await jobs.idle();
  await assert.rejects(jobs.provisional(job.id, "user-1"), /No evidence batch/);
  const invalid = analysis(); invalid.fields = [{ sources: [{ document_id: "doc", document_name: "doc.pdf", page: 8, supporting_text: "unread", evidence_mode: "document_vision" }] }];
  assert.throws(() => verifyReviewedSourcePages(invalid, [{ document_id: "doc", document_name: "doc.pdf", pages: [{ page: 1 }] }]), /Review rejected: Claude cited unreviewed evidence \(doc\.pdf, page 8\).*No pages from this batch were counted/);
  const error = describeAnalysisFailure(new Error("Bad image [image_request_error]"), { active_batch: [{ document_name: "doc.pdf", pages: [8] }] });
  assert.match(error.message, /provisional draft/);
});

test("real 180-page PDF inspection and range extraction retain original page numbers", async () => {
  const document = new jsPDF();
  for (let page = 1; page <= 180; page += 1) {
    if (page > 1) document.addPage();
    document.text(`Claim evidence page ${page}`, 15, 20);
  }
  const buffer = Buffer.from(document.output("arraybuffer"));
  assert.equal((await inspectPdf(buffer)).page_count, 180);
  const extracted = await extractEvidenceFile({ buffer, originalname: "large.pdf", mimetype: "application/pdf", size: buffer.length }, { id: "large", page_range: { start: 171, end: 180 } });
  assert.equal(extracted.extraction_status, "extracted");
  assert.deepEqual(extracted.pages.map((page) => page.page), [171, 172, 173, 174, 175, 176, 177, 178, 179, 180]);
  assert.match(extracted.pages[0].text, /171/);
  const merged = mergeJobEvidence([{ ...extracted, vision_images: [{ page: 171, buffer: Buffer.from("image") }] }]);
  assert.equal(Buffer.isBuffer(merged[0].vision_images[0].buffer), true);
});

test("discussion persists once per request and rejects invented citations and other owners", async (t) => {
  const { jobs } = fixture(t, { inspect: async () => ({ page_count: 1 }), providerFactory: () => ({ analyze: async () => {
    const result = response(); result.analysis.fields = [{ value: "evidence", sources: [{ document_id: "doc-1", document_name: "bundle.pdf", page: 1, supporting_text: "Evidence on page 1.", evidence_mode: "extracted_text" }] }]; return result;
  } }) });
  const job = await jobs.create(request()); await jobs.idle();
  let calls = 0, citation = "E1";
  const chat = createAnalysisChat({ jobs, env: { ANTHROPIC_API_KEY: "test-only" }, fetchImpl: async () => { calls += 1; return Response.json({ stop_reason: "end_turn", model: "claude-sonnet-4-6", content: [{ type: "text", text: JSON.stringify({ answer: `See saved evidence [${citation}].`, citation_ids: [citation] }) }], usage: {} }); } });
  const input = { message: "What supports this finding?", request_id: "request-1234" };
  const first = await chat.send(job.id, "user-1", input);
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[1].sources[0].page, 1);
  await chat.send(job.id, "user-1", input); assert.equal(calls, 1);
  assert.throws(() => chat.history(job.id, "other-user"), /not found/);
  citation = "E999";
  await assert.rejects(chat.send(job.id, "user-1", { ...input, request_id: "request-5678" }), /unverified reference/);
  assert.equal(chat.history(job.id, "user-1").messages.length, 2);
});

test("staged jobs run the real Claude schema and grounding pipeline through final reconciliation", async (t) => {
  const payloads = [];
  const provider = createAnthropicProvider({ apiKey: "mock-only", model: "claude-sonnet-4-6", fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); payloads.push(body);
    const synthesis = body.messages[0].content.some((block) => block.text?.startsWith("WHOLE-CLAIM"));
    const output = structuredClone(validAnthropicAnalysisFixture);
    if (!synthesis) {
      const present = new Set(multiDocumentEvidenceFixture.filter((item) => body.messages[0].content[0].text.includes(`DOCUMENT ID: ${item.document_id}`)).map((item) => item.document_id));
      for (const collection of [output.document_types, output.fields, output.evidence_findings]) {
        for (const record of collection) record.sources = record.sources.filter((source) => present.has(source.document_id));
      }
      output.fields = output.fields.filter((field) => field.sources.length || field.value === null);
      output.document_types = output.document_types.filter((item) => item.sources.length);
      output.evidence_findings = output.evidence_findings.filter((item) => item.sources.length);
      output.classification.sources = output.classification.sources.filter((source) => present.has(source.document_id));
      if (!output.classification.sources.length) output.classification = { business_line: "Other / Requires Review", confidence: 0, rationale: "Batch requires whole-claim reconciliation.", sources: [] };
    }
    return Response.json(anthropicMessageFixture(output));
  } });
  const { jobs } = fixture(t, { providerFactory: () => provider, extract: extractEvidenceFile, measure: ({ evidence, analysisContext }) => ({ fits: analysisContext?.startsWith("WHOLE-CLAIM") || evidence.length <= 1 }) });
  const input = request();
  input.files = multiDocumentEvidenceFixture.map((item) => { const buffer = Buffer.from(item.pages[0].text); return { originalname: item.document_name, mimetype: item.mime_type, size: buffer.length, buffer }; });
  input.manifest = multiDocumentEvidenceFixture.map((item) => ({ id: item.document_id, file_name: item.document_name }));
  const submitted = await jobs.create(input); await jobs.idle();
  const state = jobs.get(submitted.id, "user-1");
  assert.equal(state.state, "complete", JSON.stringify(state.error));
  assert.equal(payloads.length, 4);
  const result = jobs.result(submitted.id, "user-1");
  assert.equal(result.analysis.classification.business_line, "Air Shipment (NET)");
  assert.equal(result.analysis.fields.find((field) => field.field === "insured").value, "Example Trading SAL");
  assert.equal(result.evidence_snapshot.length, 3);
  assert.match(payloads.at(-1).system, /OWNER-APPROVED STAGED WORKFLOW/);
  assert.match(payloads.at(-1).messages[0].content[0].text, /already|saved batches/);
});
