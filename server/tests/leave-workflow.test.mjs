import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  calculateWorkingDays,
  createPendingLeave,
  leaveBalances,
  transitionLeave,
} from "../../src/lib/leaveWorkflow.js";
import { createLeaveEmailService } from "../leave/leaveEmailService.mjs";
import { createMicrosoftGraphMailClient, getMicrosoftGraphStatus } from "../integrations/microsoftGraphMail.mjs";

const employee = (overrides = {}) => ({
  id: "employee-1",
  name: "Employee One",
  email: "employee@example.com",
  annual_leave_total: 15,
  annual_leave_used: 3,
  toil_balance: 4,
  ...overrides,
});
const database = (overrides = {}) => ({ Employee: [employee()], Leave: [], ...overrides });
const requestInput = (overrides = {}) => ({
  employee_id: "employee-1",
  leave_type: "Annual Leave",
  start_date: "2026-08-17",
  end_date: "2026-08-19",
  note: "Family commitment",
  client_request_id: "client-request-1",
  ...overrides,
});

test("working-day calculation is inclusive and excludes weekends", () => {
  assert.equal(calculateWorkingDays("2026-08-14", "2026-08-18"), 3);
  assert.equal(calculateWorkingDays("2026-08-15", "2026-08-16"), 0);
  assert.equal(calculateWorkingDays("2026-08-18", "2026-08-17"), 0);
});

test("submission saves Pending without deducting and rejects insufficient balance", () => {
  const original = database();
  const result = createPendingLeave(original, requestInput(), { id: "leave-1", now: "2026-08-17T10:00:00.000Z" });
  assert.equal(result.leave.status, "Pending");
  assert.equal(result.leave.days, 3);
  assert.equal(result.leave.balance_deduction_applied, false);
  assert.deepEqual(result.leave.submission_balance_snapshot, { annual_leave: 12, toil: 4, total: 16 });
  assert.equal(result.database.Employee[0].annual_leave_used, 3);
  assert.equal(original.Leave.length, 0);
  assert.throws(() => createPendingLeave(database(), requestInput({ start_date: "2026-08-03", end_date: "2026-08-21" }), { id: "leave-too-large" }), /Insufficient Annual Leave/i);
});

test("duplicate submission key returns the existing request", () => {
  const first = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const duplicate = createPendingLeave(first.database, requestInput(), { id: "leave-2" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.leave.id, "leave-1");
  assert.equal(duplicate.database.Leave.length, 1);
});

test("approval deducts the correct balance exactly once and TOIL stays separate", () => {
  const pending = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const approved = transitionLeave(pending.database, "leave-1", "Approved", { now: "2026-08-20T10:00:00.000Z" });
  assert.equal(approved.leave.status, "Approved");
  assert.equal(approved.leave.balance_deduction_applied, true);
  assert.equal(approved.employee.annual_leave_used, 6);
  assert.equal(approved.employee.toil_balance, 4);
  const duplicate = transitionLeave(approved.database, "leave-1", "Approved");
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.employee.annual_leave_used, 6);

  const toilPending = createPendingLeave(database(), requestInput({ leave_type: "TOIL", start_date: "2026-08-17", end_date: "2026-08-18", client_request_id: "toil-1" }), { id: "leave-toil" });
  const toilApproved = transitionLeave(toilPending.database, "leave-toil", "Approved");
  assert.equal(toilApproved.employee.annual_leave_used, 3);
  assert.equal(toilApproved.employee.toil_balance, 2);

  // TOIL Claim (+ recharge)
  const claimPending = createPendingLeave(database(), requestInput({ leave_type: "TOIL Claim", start_date: "2026-08-17", end_date: "2026-08-19", client_request_id: "claim-1" }), { id: "leave-claim" });
  const claimApproved = transitionLeave(claimPending.database, "leave-claim", "Approved");
  assert.equal(claimApproved.employee.annual_leave_used, 3); // Annual untouched
  assert.equal(claimApproved.employee.toil_balance, 7); // 4 + 3 days recharged!
  assert.equal(claimApproved.leave.balance_credit_applied, true);

  // Unpaid Leave (0 balance impact)
  const unpaidPending = createPendingLeave(database(), requestInput({ leave_type: "Unpaid Leave", start_date: "2026-08-17", end_date: "2026-08-18", client_request_id: "unpaid-1" }), { id: "leave-unpaid" });
  const unpaidApproved = transitionLeave(unpaidPending.database, "leave-unpaid", "Approved");
  assert.equal(unpaidApproved.employee.annual_leave_used, 3);
  assert.equal(unpaidApproved.employee.toil_balance, 4);
});

test("rejection does not deduct and cannot later be approved", () => {
  const pending = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const rejected = transitionLeave(pending.database, "leave-1", "Rejected");
  assert.equal(rejected.employee.annual_leave_used, 3);
  assert.equal(rejected.employee.toil_balance, 4);
  assert.equal(rejected.leave.balance_deduction_applied, false);
  assert.throws(() => transitionLeave(rejected.database, "leave-1", "Approved"), /already rejected/i);
});

test("invalid Microsoft configuration fails before any network request", async () => {
  let calls = 0;
  const status = getMicrosoftGraphStatus({});
  assert.equal(status.configured, false);
  assert.ok(status.missing.includes("MICROSOFT_CLIENT_SECRET"));
  assert.throws(() => createMicrosoftGraphMailClient({ env: {}, fetchImpl: async () => { calls += 1; } }), /not configured/i);
  assert.equal(calls, 0);
});

test("Outlook submission email is grounded, server-side, and idempotent", async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-leave-mail-"));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const env = {
    MICROSOFT_TENANT_ID: "tenant-id",
    MICROSOFT_CLIENT_ID: "client-id",
    MICROSOFT_CLIENT_SECRET: "server-only-secret",
    MICROSOFT_SENDER_EMAIL: "leave-sender@example.com",
    LEAVE_ADMIN_EMAIL: "manager@example.com",
    LEAVE_ADMIN_CC_EMAIL: "second-manager@example.com",
    APP_BASE_URL: "https://ula.example.com",
  };
  let tokenCalls = 0;
  let graphCalls = 0;
  let graphRequest;
  const fetchImpl = async (url, options) => {
    if (String(url).includes("login.microsoftonline.com")) {
      tokenCalls += 1;
      assert.match(String(options.body), /client_secret=server-only-secret/);
      return new Response(JSON.stringify({ access_token: "mock-access-token", expires_in: 3600 }), { status: 200 });
    }
    graphCalls += 1;
    graphRequest = { url: String(url), options };
    return new Response(null, { status: 202 });
  };
  const pending = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const service = createLeaveEmailService({ env, fetchImpl, stateFile: path.join(temporaryDirectory, "delivery.json"), wait: async () => {} });
  const event = {
    event_type: "submitted",
    idempotency_key: "leave:leave-1:submitted",
    leave: pending.leave,
    employee: pending.employee,
  };
  const first = await service.sendEvent(event);
  const second = await service.sendEvent(event);
  const requestBody = JSON.parse(graphRequest.options.body);
  assert.equal(first.status, "sent");
  assert.equal(second.deduplicated, true);
  assert.equal(tokenCalls, 1);
  assert.equal(graphCalls, 1);
  assert.match(graphRequest.url, /users\/leave-sender%40example.com\/sendMail$/);
  assert.equal(requestBody.message.toRecipients[0].emailAddress.address, "manager@example.com");
  assert.equal(requestBody.message.ccRecipients[0].emailAddress.address, "second-manager@example.com");
  assert.match(requestBody.message.body.content, /Employee One/);
  assert.match(requestBody.message.body.content, /Family commitment/);
  assert.match(requestBody.message.body.content, /leave-1/);
  assert.match(requestBody.message.body.content, /12 days/);
  assert.match(requestBody.message.body.content, /https:\/\/ula\.example\.com\/annual-leave\?request=leave-1/);
  assert.doesNotMatch(JSON.stringify(requestBody), /server-only-secret|mock-access-token/);
});

test("Graph failure is recorded without changing the saved leave request", async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-leave-failure-"));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const env = {
    MICROSOFT_TENANT_ID: "tenant-id",
    MICROSOFT_CLIENT_ID: "client-id",
    MICROSOFT_CLIENT_SECRET: "secret",
    MICROSOFT_SENDER_EMAIL: "sender@example.com",
    LEAVE_ADMIN_EMAIL: "manager@example.com",
    APP_BASE_URL: "https://ula.example.com",
  };
  const pending = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const fetchImpl = async (url) => String(url).includes("login.microsoftonline.com")
    ? new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify({ error: { message: "Mailbox unavailable" } }), { status: 503 });
  const stateFile = path.join(temporaryDirectory, "delivery.json");
  const service = createLeaveEmailService({ env, fetchImpl, stateFile, wait: async () => {} });
  await assert.rejects(service.sendEvent({ event_type: "submitted", idempotency_key: "leave:leave-1:submitted", leave: pending.leave, employee: pending.employee }), /Mailbox unavailable/);
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  assert.equal(state.events["leave:leave-1:submitted"].status, "failed");
  assert.equal(pending.leave.status, "Pending");
  assert.equal(leaveBalances(pending.employee).annual_leave, 12);
});

test("approval and rejection notifications go to the employee with the correct decision state", async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-leave-decisions-"));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const env = {
    MICROSOFT_TENANT_ID: "tenant-id",
    MICROSOFT_CLIENT_ID: "client-id",
    MICROSOFT_CLIENT_SECRET: "secret",
    MICROSOFT_SENDER_EMAIL: "sender@example.com",
    LEAVE_ADMIN_EMAIL: "manager@example.com",
    APP_BASE_URL: "https://ula.example.com",
  };
  const sentMessages = [];
  const fetchImpl = async (url, options) => {
    if (String(url).includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    sentMessages.push(JSON.parse(options.body));
    return new Response(null, { status: 202 });
  };
  const pendingApproved = createPendingLeave(database(), requestInput(), { id: "leave-approved" });
  const approved = transitionLeave(pendingApproved.database, "leave-approved", "Approved");
  const pendingRejected = createPendingLeave(database(), requestInput({ client_request_id: "rejected-client" }), { id: "leave-rejected" });
  const rejected = transitionLeave(pendingRejected.database, "leave-rejected", "Rejected");
  const service = createLeaveEmailService({ env, fetchImpl, stateFile: path.join(temporaryDirectory, "delivery.json"), wait: async () => {} });
  await service.sendEvent({ event_type: "approved", idempotency_key: "leave:leave-approved:approved", leave: approved.leave, employee: approved.employee });
  await service.sendEvent({ event_type: "rejected", idempotency_key: "leave:leave-rejected:rejected", leave: rejected.leave, employee: rejected.employee });
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].message.toRecipients[0].emailAddress.address, "employee@example.com");
  assert.match(sentMessages[0].message.subject, /approved/i);
  assert.match(sentMessages[0].message.body.content, /9 days/);
  assert.match(sentMessages[1].message.subject, /rejected/i);
  assert.match(sentMessages[1].message.body.content, /No leave balance/i);
});

test("Graph retries an explicit throttling response without duplicating a successful event", async (context) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-leave-throttle-"));
  context.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }));
  const env = {
    MICROSOFT_TENANT_ID: "tenant-id",
    MICROSOFT_CLIENT_ID: "client-id",
    MICROSOFT_CLIENT_SECRET: "secret",
    MICROSOFT_SENDER_EMAIL: "sender@example.com",
    LEAVE_ADMIN_EMAIL: "manager@example.com",
    APP_BASE_URL: "https://ula.example.com",
  };
  let graphCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
    graphCalls += 1;
    return graphCalls === 1
      ? new Response(JSON.stringify({ error: { message: "Throttled" } }), { status: 429, headers: { "retry-after": "0" } })
      : new Response(null, { status: 202 });
  };
  const pending = createPendingLeave(database(), requestInput(), { id: "leave-1" });
  const service = createLeaveEmailService({ env, fetchImpl, stateFile: path.join(temporaryDirectory, "delivery.json"), wait: async () => {} });
  const event = { event_type: "submitted", idempotency_key: "leave:leave-1:submitted", leave: pending.leave, employee: pending.employee };
  const sent = await service.sendEvent(event);
  const duplicate = await service.sendEvent(event);
  assert.equal(sent.status, "sent");
  assert.equal(duplicate.deduplicated, true);
  assert.equal(graphCalls, 2);
});
