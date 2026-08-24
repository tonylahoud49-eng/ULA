import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createEmailJSMailClient, getEmailJSStatus } from "../integrations/emailjsMail.mjs";
import { createLeaveEmailService } from "../leave/leaveEmailService.mjs";

const VALID_EMAILJS_ENV = {
  LEAVE_EMAIL_PROVIDER: "emailjs",
  EMAILJS_SERVICE_ID: "service_mock123",
  EMAILJS_TEMPLATE_ID: "template_mock456",
  EMAILJS_PUBLIC_KEY: "public_key_abc",
  EMAILJS_PRIVATE_KEY: "private_key_xyz",
  LEAVE_ADMIN_EMAIL: "admin@company.com",
  APP_BASE_URL: "http://localhost:5173",
};

const sampleLeave = () => ({
  id: "req-emailjs-001",
  employee_name: "Sarah Jenkins",
  employee_email: "sarah@company.com",
  leave_type: "Annual Leave",
  start_date: "2026-09-01",
  end_date: "2026-09-03",
  days: 3,
  note: "Family vacation",
  status: "Pending",
  submission_balance_snapshot: { annual_leave: 12, toil: 2, total: 14 },
});

const sampleEmployee = () => ({
  id: "emp-001",
  name: "Sarah Jenkins",
  email: "sarah@company.com",
  annual_leave_total: 15,
  annual_leave_used: 3,
  toil_balance: 2,
});

test("EmailJS status detects configured and unconfigured states", () => {
  const unconfigured = getEmailJSStatus({});
  assert.equal(unconfigured.configured, false);
  assert.ok(unconfigured.missing.includes("EMAILJS_SERVICE_ID"));
  assert.ok(unconfigured.missing.includes("EMAILJS_TEMPLATE_ID"));
  assert.ok(unconfigured.missing.includes("EMAILJS_PUBLIC_KEY"));

  const configured = getEmailJSStatus(VALID_EMAILJS_ENV);
  assert.equal(configured.configured, true);
  assert.equal(configured.missing.length, 0);
  assert.equal(configured.has_private_key, true);
});

test("EmailJS client formats request body with public and private keys and sends successfully", async () => {
  let capturedUrl = null;
  let capturedBody = null;
  let capturedHeaders = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    capturedHeaders = options.headers;
    return new Response("OK", { status: 200 });
  };

  const client = createEmailJSMailClient({
    env: VALID_EMAILJS_ENV,
    fetchImpl: mockFetch,
  });

  const result = await client.sendMail({
    to: "admin@company.com",
    toName: "Leave Administrator",
    subject: "New Leave Request",
    html: "<p>Please review leave</p>",
    templateParams: { employee_name: "Sarah Jenkins", days: 3 },
    idempotencyKey: "leave:req-emailjs-001:submitted",
  });

  assert.equal(result.status, "sent");
  assert.equal(result.provider, "emailjs");
  assert.equal(capturedUrl, "https://api.emailjs.com/api/v1.0/email/send");
  assert.equal(capturedHeaders["content-type"], "application/json");
  assert.equal(capturedBody.service_id, "service_mock123");
  assert.equal(capturedBody.template_id, "template_mock456");
  assert.equal(capturedBody.user_id, "public_key_abc");
  assert.equal(capturedBody.accessToken, "private_key_xyz");
  assert.equal(capturedBody.template_params.to_email, "admin@company.com");
  assert.equal(capturedBody.template_params.subject, "New Leave Request");
  assert.equal(capturedBody.template_params.message_html, "<p>Please review leave</p>");
  assert.equal(capturedBody.template_params.employee_name, "Sarah Jenkins");
  assert.equal(capturedBody.template_params.days, 3);
});

test("EmailJS client retries on HTTP 429 and succeeds", async () => {
  let attempts = 0;
  const mockFetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("Rate limit exceeded", { status: 429 });
    }
    return new Response("OK", { status: 200 });
  };

  const client = createEmailJSMailClient({
    env: VALID_EMAILJS_ENV,
    fetchImpl: mockFetch,
    wait: async () => {},
  });

  const result = await client.sendMail({
    to: "admin@company.com",
    subject: "Test Retry",
    html: "<p>Test</p>",
    idempotencyKey: "test:retry",
  });

  assert.equal(result.status, "sent");
  assert.equal(attempts, 2);
});

test("leaveEmailService sends submission email via EmailJS and records idempotency", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-emailjs-test-"));
  const stateFile = path.join(temporaryDirectory, "delivery.json");

  let sentPayload = null;
  const mockFetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response("OK", { status: 200 });
  };

  const service = createLeaveEmailService({
    env: VALID_EMAILJS_ENV,
    fetchImpl: mockFetch,
    stateFile,
    wait: async () => {},
  });

  const status = service.getStatus();
  assert.equal(status.configured, true);
  assert.equal(status.provider, "emailjs");

  const event = {
    event_type: "submitted",
    idempotency_key: "leave:req-emailjs-001:submitted",
    leave: sampleLeave(),
    employee: sampleEmployee(),
  };

  const firstDelivery = await service.sendEvent(event);
  assert.equal(firstDelivery.status, "sent");
  assert.equal(sentPayload.template_params.to_email, "admin@company.com");
  assert.equal(sentPayload.template_params.employee_name, "Sarah Jenkins");
  assert.equal(sentPayload.template_params.days, 3);
  assert.match(sentPayload.template_params.message_html, /Leave request awaiting review/);

  // Second call should deduplicate without sending network request again
  sentPayload = null;
  const secondDelivery = await service.sendEvent(event);
  assert.equal(secondDelivery.status, "sent");
  assert.equal(secondDelivery.deduplicated, true);
  assert.equal(sentPayload, null);

  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test("leaveEmailService sends decision email to employee via EmailJS", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-emailjs-test-"));
  const stateFile = path.join(temporaryDirectory, "delivery.json");

  let sentPayload = null;
  const mockFetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response("OK", { status: 200 });
  };

  const service = createLeaveEmailService({
    env: VALID_EMAILJS_ENV,
    fetchImpl: mockFetch,
    stateFile,
    wait: async () => {},
  });

  const approvedLeave = { ...sampleLeave(), status: "Approved" };
  const event = {
    event_type: "approved",
    idempotency_key: "leave:req-emailjs-001:approved",
    leave: approvedLeave,
    employee: sampleEmployee(),
  };

  const delivery = await service.sendEvent(event);
  assert.equal(delivery.status, "sent");
  assert.equal(sentPayload.template_params.to_email, "sarah@company.com");
  assert.equal(sentPayload.template_params.decision, "Approved");
  assert.match(sentPayload.template_params.message_html, /Request Approved/i);

  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});
