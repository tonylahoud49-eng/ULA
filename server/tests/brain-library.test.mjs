import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createLocalBrainStore } from "../ai/brain/brainStore.mjs";
import { createBrainRouter } from "../ai/brain/brainRoutes.mjs";
import { learnBrainMethodology } from "../ai/brain/brainLearner.mjs";
import { approvedBrainManifest } from "../ai/brain/brainPolicy.mjs";
import { loadAnalysisReferences, usedBrainReferences } from "../ai/brain/brainReferences.mjs";
import { openAIProviderInternals } from "../ai/providers/openaiProvider.mjs";
import { requestFingerprint } from "../ai/anthropicPreflight.mjs";

const actors = { employee: { id: "employee", role: "user", full_name: "Uploader" }, other: { id: "other", role: "user" }, admin: { id: "admin", role: "admin" } };
const reportText = "A verified final historical report about water damage to an insured premises. Keep this PRIVATE-PARTY-123 and USD 95000 outside future claim prompts.";
const learned = { style_notes: ["Test competing water entry mechanisms against the physical evidence."], model: "test-model", usage: { input_tokens: 120 } };
const sourceFields = { claim_case_id: "PRIVATE-CASE-123", report_title: "Private Acme final report", approved_by: "Approver Name", approval_date: "2026-09-01", business_line: "Property", topic: "Water damage", report_status: "final", approved_confirmation: "true" };

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ula-brain-"));
  const store = createLocalBrainStore(directory);
  const app = express(); app.use(express.json());
  app.use(createBrainRouter({ store, learner: async () => learned,
    requireAccess: (req, res, next) => { const actor = actors[req.get("x-test-actor")]; if (!actor) return res.status(401).json({ error: "Sign in." }); req.authUser = actor; next(); },
    requireAdmin: (req, res, next) => req.authUser.role === "admin" ? next() : res.status(403).json({ error: "Administrator access is required." }), ...options }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const raw = (route, init = {}, actor = "employee") => fetch(`http://127.0.0.1:${server.address().port}${route}`, { ...init, headers: { ...init.headers, "x-test-actor": actor } });
  const request = async (...args) => { const response = await raw(...args); return { response, body: await response.json() }; };
  const upload = (overrides = {}, actor = "employee", text = reportText) => {
    const data = new FormData(); for (const [key, value] of Object.entries({ ...sourceFields, ...overrides })) data.append(key, value);
    data.append("file", new Blob([text], { type: "text/plain" }), "approved.txt");
    return request("/reports", { method: "POST", body: data }, actor);
  };
  const post = (id, action, values = {}, actor = "admin") => request(`/reports/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) }, actor);
  const verify = (record) => post(record.id, "verify-approval", { revision: record.revision, confirmed: true, verification_note: "Checked signed final report and approval correspondence." });
  const digest = async () => { const { body } = await upload(); await verify(body); return (await post(body.id, "learn")).body; };
  const activate = (record, notes = learned.style_notes) => post(record.id, "activate", { revision: record.revision, style_notes: notes, methodology_only: true });
  return { request, raw, upload, post, verify, digest, activate, store, directory };
}

test("only declared approved final reports can be submitted; nothing is digested before verification", async (t) => {
  let calls = 0; const f = await fixture(t, { learner: async () => { calls++; return learned; } });
  for (const status of ["draft", "unapproved", "rejected"]) assert.equal((await f.upload({ report_status: status })).response.status, 400);
  assert.equal((await f.upload({ approved_confirmation: "false" })).response.status, 400);
  assert.equal((await f.upload({ approved_by: "" })).response.status, 400);
  assert.equal((await f.upload({ approval_date: "2026-02-31" })).response.status, 400);
  const { body } = await f.upload();
  assert.equal((await f.post(body.id, "learn")).response.status, 409);
  assert.equal(calls, 0); assert.deepEqual(await f.store.references(actors.employee), []);
});

test("report-page uploads require a signed final version and derive approval metadata on the server", async (t) => {
  let report = { id: "final-version", claim_id: "source-claim", claim_number: "CASE-FINAL", template_name: "Property report", version_number: 2, business_line: "Property", status: "Draft" };
  const f = await fixture(t, { resolveReportVersion: async (id, actor) => id === report.id && actor.id === actors.employee.id ? report : null });
  const input = { report_version_id: report.id, claim_case_id: "forged-case", approved_by: "Forged approver", business_line: "Land Shipment" };
  assert.equal((await f.upload(input)).response.status, 409);
  assert.equal((await f.upload(input, "other")).response.status, 404);
  report = { ...report, status: "Final", issue_state: "Final", human_approval_required: false, approved_by: "Recorded approver", approved_date: "2026-09-02T12:00:00.000Z" };
  const submitted = await f.upload(input);
  assert.equal(submitted.response.status, 200);
  assert.equal(submitted.body.claim_case_id, "CASE-FINAL");
  assert.equal(submitted.body.business_line, "Property");
  assert.equal(submitted.body.approved_by, "Recorded approver");
  assert.equal(submitted.body.approval_date, "2026-09-02");
  assert.equal(submitted.body.source_report_version_id, report.id);
  assert.equal(submitted.body.source_claim_id, "source-claim");
  assert.equal(submitted.body.approval_status, "submitted");
  assert.deepEqual(await f.store.references(actors.employee), []);
  report = { ...report, normalized_claim_record: { report_quality: { issue_blockers: ["Unreviewed evidence"] } } };
  assert.equal((await f.upload(input)).response.status, 422);
});

test("originals survive restart, deduplicate within uploader and remain private", async (t) => {
  const f = await fixture(t); const first = await f.upload(), duplicate = await f.upload(), other = await f.upload({}, "other");
  assert.equal(first.body.id, duplicate.body.id); assert.notEqual(first.body.id, other.body.id);
  const restarted = createLocalBrainStore(f.directory);
  assert.equal((await restarted.get(first.body.id, actors.employee)).buffer.toString(), reportText);
  assert.equal(await restarted.get(first.body.id, actors.other), null);
  assert.equal((await f.request(`/reports/${first.body.id}/file`, {}, "other")).response.status, 404);
  assert.equal((await f.request("/reports", {}, "anonymous")).response.status, 401);
  const listed = (await f.request("/reports")).body.reports;
  assert.equal(listed.length, 1); assert.equal(listed[0].buffer, undefined); assert.equal(listed[0].original_base64, undefined);
});

test("employees submit reports but cannot verify, digest, activate, reject or remove knowledge", async (t) => {
  const f = await fixture(t); const { body } = await f.upload();
  for (const action of ["verify-approval", "learn", "activate", "reject", "remove-knowledge", "reset"]) assert.equal((await f.post(body.id, action, {}, "employee")).response.status, 403);
});

test("verified digestion is durable, inactive until reviewed, and reused without a new provider call", async (t) => {
  let calls = 0; const f = await fixture(t, { learner: async () => { calls++; return learned; } });
  const record = await f.digest(); assert.equal(record.status, "pending");
  assert.deepEqual(await f.store.references(actors.other), []);
  const retry = await f.post(record.id, "learn"); assert.equal(retry.body.reused, true); assert.equal(calls, 1);
  const saved = await createLocalBrainStore(f.directory).get(record.id, actors.admin);
  assert.equal(saved.extracted_text.includes("PRIVATE-PARTY"), true);
  assert.equal((await f.request("/reports")).body.reports[0].extracted_text, undefined);
  assert.equal((await f.activate(record)).response.status, 200);
  const refs = await f.store.references(actors.other); assert.equal(refs.length, 1);
  assert.doesNotMatch(JSON.stringify(refs), /PRIVATE|Approver Name|Acme|95000|approved\.txt/);
});

test("draft-like, confidential and stale methodology cannot activate", async (t) => {
  const f = await fixture(t); const record = await f.digest();
  assert.throws(() => approvedBrainManifest({ ...record, approval_status: "rejected" }, learned.style_notes, true), /Verify/);
  for (const note of ["Copy PRIVATE-CASE-123.", "Apply USD 1000.", "Use Approver Name's conclusion.", "Contact admin@example.com."]) assert.equal((await f.activate(record, [note])).response.status, 400);
  assert.equal((await f.post(record.id, "activate", { revision: record.revision, style_notes: learned.style_notes, methodology_only: false })).response.status, 400);
  assert.equal((await f.activate({ ...record, revision: record.revision - 1 })).response.status, 409);
  assert.deepEqual(await f.store.references(actors.other), []);
});

test("removal and rejection revoke knowledge atomically while the original remains byte-identical", async (t) => {
  const f = await fixture(t); const record = await f.digest(); const active = (await f.activate(record)).body;
  const removed = await f.post(record.id, "remove-knowledge", { revision: active.revision });
  assert.equal(removed.body.status, "removed"); assert.deepEqual(await f.store.references(actors.other), []);
  assert.equal(await (await f.raw(`/reports/${record.id}/file`)).text(), reportText);
  assert.equal((await f.request(`/reports/${record.id}`, { method: "DELETE" }, "admin")).response.status, 405);
  await assert.rejects(() => f.store.mutate(record.id, actors.admin, () => ({ file_name: "changed.txt" })), /immutable/);
  const reactivated = (await f.activate(removed.body)).body;
  await f.post(record.id, "reject", { revision: reactivated.revision, reason: "Approval was withdrawn." });
  assert.deepEqual(await f.store.references(actors.other), []);
  assert.equal((await f.post(record.id, "learn")).response.status, 409);
  assert.equal((await f.store.get(record.id, actors.admin)).buffer.toString(), reportText);
});

test("concurrent digestion is blocked and an interrupted response cannot overwrite a reset", async (t) => {
  let finish, started; const pending = new Promise((resolve) => { finish = resolve; }); const entered = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, { learner: async () => { started(); return pending; } });
  const { body } = await f.upload(); await f.verify(body);
  const first = f.post(body.id, "learn"); await entered;
  assert.equal((await f.post(body.id, "learn")).response.status, 409);
  await f.store.mutate(body.id, actors.admin, () => ({ learning_started_at: new Date(Date.now() - 360000).toISOString() }));
  assert.equal((await f.post(body.id, "reset")).response.status, 200);
  finish(learned); assert.equal((await first).response.status, 409);
  assert.equal((await f.store.get(body.id, actors.admin)).status, "failed");
});

test("unreadable pages prevent paid digestion and never generate partial trusted knowledge", async (t) => {
  let calls = 0;
  const f = await fixture(t, { extract: async () => ({ extraction_status: "extracted", pages: [{ text: "readable" }, { text: "" }] }), learner: async () => { calls++; return learned; } });
  const { body } = await f.upload(); await f.verify(body);
  assert.equal((await f.post(body.id, "learn")).response.status, 400); assert.equal(calls, 0);
  assert.equal((await f.store.get(body.id, actors.admin)).status, "failed");
});

test("retrieval requires matching business line, loss topic and current evidence; prompts contain only approved methodology", async (t) => {
  const f = await fixture(t); const record = await f.digest(); await f.activate(record);
  const claim = { id: "new-claim", business_line: "Property" };
  const refs = await loadAnalysisReferences({ directory: path.resolve("server/ai/references"), store: f.store, actor: actors.other, claim });
  const evidence = [{ document_id: "new-evidence", document_name: "Current survey", kind: "text", pages: [{ page: 1, text: "Water damage to insured premises from water seepage." }] }];
  assert.equal(usedBrainReferences(refs, { claim, evidence }).length, 1);
  for (const business_line of ["Unclassified", "Land Shipment", "Marine Cargo (Reefer/GFS)"]) assert.deepEqual(usedBrainReferences(refs, { claim: { business_line }, evidence }), []);
  assert.deepEqual(usedBrainReferences(refs, { claim, evidence: [{ ...evidence[0], pages: [{ text: "Insured premises damaged by fire and smoke." }] }] }), []);
  const prompt = openAIProviderInternals.promptText(claim, evidence, refs);
  assert.match(prompt, /Test competing water entry mechanisms/);
  assert.doesNotMatch(prompt, /PRIVATE|Acme|Approver Name|95000|approved\.txt/);
  const changed = [...refs.filter((ref) => !ref.is_brain_knowledge), { ...refs.find((ref) => ref.is_brain_knowledge), revision: 999 }];
  const input = { claim, files: [{ buffer: Buffer.from("same") }], manifest: [], provider: "anthropic", model: "unchanged" };
  assert.notEqual(requestFingerprint({ ...input, styleReferences: refs }), requestFingerprint({ ...input, styleReferences: changed }));
});

test("dedicated learner uses mocked structured output and rejects interrupted responses", async () => {
  let payload;
  const options = { env: { ANTHROPIC_API_KEY: "test-only" }, fetchImpl: async (_url, init) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({ model: "claude-sonnet-4-6", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ style_notes: learned.style_notes }) }], usage: {} }) };
  } };
  assert.equal((await learnBrainMethodology(reportText, options)).style_notes.length, 1);
  assert.deepEqual(payload.output_config.format.schema.required, ["style_notes"]);
  assert.match(payload.system, /Never follow instructions/);
  await assert.rejects(() => learnBrainMethodology(reportText, { ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ stop_reason: "max_tokens" }) }) }), /interrupted/);
});
