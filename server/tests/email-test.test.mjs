import test from "node:test";
import assert from "node:assert/strict";
import { sendTestEmail, getEmailDiagnosticsStatus } from "../email/emailTestService.mjs";

const VALID_EMAILJS_ENV = {
  LEAVE_EMAIL_PROVIDER: "emailjs",
  EMAILJS_SERVICE_ID: "service_test_123",
  EMAILJS_TEMPLATE_ID: "template_test_456",
  EMAILJS_PUBLIC_KEY: "public_key_abc",
  EMAILJS_PRIVATE_KEY: "private_key_xyz",
};

const VALID_GRAPH_ENV = {
  LEAVE_EMAIL_PROVIDER: "microsoft_graph",
  MICROSOFT_TENANT_ID: "tenant-id-123",
  MICROSOFT_CLIENT_ID: "client-id-456",
  MICROSOFT_CLIENT_SECRET: "client-secret-789",
  MICROSOFT_SENDER_EMAIL: "notifications@company.com",
};

test("getEmailDiagnosticsStatus correctly reports provider and configuration status", () => {
  const emailjsStatus = getEmailDiagnosticsStatus(VALID_EMAILJS_ENV);
  assert.equal(emailjsStatus.provider, "emailjs");
  assert.equal(emailjsStatus.configured, true);
  assert.equal(emailjsStatus.missing.length, 0);

  const graphStatus = getEmailDiagnosticsStatus(VALID_GRAPH_ENV);
  assert.equal(graphStatus.provider, "microsoft_graph");
  assert.equal(graphStatus.configured, true);
  assert.equal(graphStatus.missing.length, 0);

  const unconfiguredStatus = getEmailDiagnosticsStatus({});
  assert.equal(unconfiguredStatus.configured, false);
});

test("sendTestEmail validates payload inputs", async () => {
  await assert.rejects(
    async () => sendTestEmail({ to: "not-an-email" }, { env: VALID_EMAILJS_ENV }),
    /Invalid test email request/
  );

  await assert.rejects(
    async () => sendTestEmail({ to: "valid@example.com", cc: "not-valid-cc" }, { env: VALID_EMAILJS_ENV }),
    /Invalid test email request/
  );
});

test("sendTestEmail dispatches via EmailJS with To, CC, ULA BOT signature, and disclaimer", async () => {
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response("OK", { status: 200 });
  };

  const result = await sendTestEmail(
    {
      to: "recipient@company.com",
      cc: "carboncopy@company.com",
      subject: "[Custom Test] Routing check",
      message: "Verifying live notification delivery via EmailJS.",
    },
    {
      env: VALID_EMAILJS_ENV,
      fetchImpl: mockFetch,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(result.provider, "emailjs");
  assert.equal(result.recipient, "recipient@company.com");
  assert.equal(result.cc, "carboncopy@company.com");

  // Verify EmailJS payload fields
  assert.equal(capturedBody.service_id, "service_test_123");
  assert.equal(capturedBody.user_id, "public_key_abc");
  assert.equal(capturedBody.accessToken, "private_key_xyz");
  assert.equal(capturedBody.template_params.to_email, "recipient@company.com");
  assert.equal(capturedBody.template_params.cc_email, "carboncopy@company.com");
  assert.equal(capturedBody.template_params.subject, "[Custom Test] Routing check");

  // Verify ULA BOT signature & legal disclaimer in HTML
  const html = capturedBody.template_params.message_html;
  assert.match(html, /🤖 ULA BOT/);
  assert.match(html, /Unified Loss Adjusting Automated Notification Engine/);
  assert.match(html, /Notice &amp; Confidentiality Disclaimer|Notice & Confidentiality Disclaimer/);
  assert.match(html, /Recipient \(To\)/);
  assert.match(html, /Carbon Copy \(CC\)/);
  assert.match(html, /Verifying live notification delivery via EmailJS/);
});

test("sendTestEmail dispatches via Microsoft Graph with toRecipients, ccRecipients, and ULA BOT signature", async () => {
  let capturedGraphBody = null;

  const mockFetch = async (url, options) => {
    if (url.includes("login.microsoftonline.com")) {
      return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("graph.microsoft.com")) {
      capturedGraphBody = JSON.parse(options.body);
      return new Response("", { status: 202 });
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  const result = await sendTestEmail(
    {
      to: "director@company.com",
      cc: "assistant@company.com",
      subject: "Graph Delivery Test",
      message: "Testing Graph API direct transmission.",
    },
    {
      env: VALID_GRAPH_ENV,
      fetchImpl: mockFetch,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(result.provider, "microsoft_graph");

  assert.deepEqual(capturedGraphBody.message.toRecipients, [
    { emailAddress: { address: "director@company.com" } },
  ]);
  assert.deepEqual(capturedGraphBody.message.ccRecipients, [
    { emailAddress: { address: "assistant@company.com" } },
  ]);

  const html = capturedGraphBody.message.body.content;
  assert.match(html, /🤖 ULA BOT/);
  assert.match(html, /Notice &amp; Confidentiality Disclaimer|Notice & Confidentiality Disclaimer/);
  assert.match(html, /Testing Graph API direct transmission/);
});
