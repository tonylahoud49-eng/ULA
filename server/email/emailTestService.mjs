import { z } from "zod";
import crypto from "node:crypto";
import { createMicrosoftGraphMailClient, getMicrosoftGraphStatus } from "../integrations/microsoftGraphMail.mjs";
import { createEmailJSMailClient, getEmailJSStatus } from "../integrations/emailjsMail.mjs";

const emailSchema = z.string().trim().email();

const testPayloadSchema = z.object({
  to: emailSchema,
  cc: z.union([emailSchema, z.literal("")]).optional().nullable(),
  subject: z.string().trim().min(1).max(200).optional().default("[ULA System Test] Automated Email Verification"),
  message: z.string().max(5000).optional().default("This is an automated test message verifying that the ULA email dispatch service and mailbox routing are operational."),
  sender_name: z.string().max(100).optional().default("ULA Automated Diagnostics"),
});

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const getProviderType = (env = process.env) => {
  const explicit = String(env.LEAVE_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "emailjs") return "emailjs";
  if (explicit === "microsoft_graph" || explicit === "graph" || explicit === "microsoft" || explicit === "outlook") return "microsoft_graph";
  if (env.EMAILJS_SERVICE_ID || env.EMAILJS_TEMPLATE_ID || env.EMAILJS_PUBLIC_KEY) return "emailjs";
  return "microsoft_graph";
};

export function getEmailDiagnosticsStatus(env = process.env) {
  const provider = getProviderType(env);
  const status = provider === "emailjs" ? getEmailJSStatus(env) : getMicrosoftGraphStatus(env);
  return {
    provider,
    configured: status.configured,
    missing: status.missing,
    invalid: status.invalid,
    sender_email: status.sender_email || null,
  };
}

const buildTestHtml = ({ to, cc, subject, message, provider, timestamp, testId }) => {
  const rows = [
    ["Test Dispatch ID", testId],
    ["Recipient (To)", to],
    ...(cc ? [["Carbon Copy (CC)", cc]] : []),
    ["Active Provider", provider === "emailjs" ? "EmailJS Dispatcher" : "Microsoft Graph API"],
    ["Timestamp", `${timestamp} UTC`],
    ["Status", "Operational Diagnostic Test"],
  ];

  const tableRows = rows
    .map(([k, v]) => `<tr><th style="border:1px solid #d9dde3;padding:9px 12px;text-align:left;background:#f6f8fb;color:#334155;font-size:13px;width:35%">${escapeHtml(k)}</th><td style="border:1px solid #d9dde3;padding:9px 12px;color:#0f172a;font-size:13px">${escapeHtml(v)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#1e293b;background-color:#f1f5f9;margin:0;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #cbd5e1;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05)">
    <!-- Header -->
    <tr>
      <td style="background:#0f2744;padding:20px 24px;border-bottom:3px solid #0284c7">
        <h1 style="color:#ffffff;font-size:18px;margin:0 0 4px 0;font-weight:700;letter-spacing:-0.01em">ULA Claims & Operations Hub</h1>
        <p style="color:#93c5fd;font-size:13px;margin:0">Automated Mailbox Diagnostic & Verification Dispatch</p>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding:24px">
        <h2 style="font-size:16px;color:#0f172a;margin-top:0;margin-bottom:12px;font-weight:600">Verification Test Message</h2>
        <p style="font-size:14px;color:#475569;margin-bottom:18px">This message was dispatched to verify live email routing, recipient addressing, and carbon-copy forwarding.</p>

        <!-- Message Highlight Box -->
        <div style="background:#f8fafc;border-left:4px solid #0284c7;padding:14px 16px;border-radius:0 6px 6px 0;margin-bottom:20px">
          <p style="font-size:14px;color:#0f172a;margin:0;white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</p>
        </div>

        <!-- Metadata Table -->
        <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
          ${tableRows}
        </table>

        <!-- Signature from ULA BOT -->
        <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:20px">
          <p style="margin:0 0 2px 0;font-size:13px;font-weight:700;color:#0f2744">🤖 ULA BOT</p>
          <p style="margin:0 0 2px 0;font-size:12px;color:#64748b">Unified Loss Adjusting Automated Notification Engine</p>
          <p style="margin:0;font-size:11px;color:#94a3b8">System Diagnostic Agent • Dispatch Service</p>
        </div>
      </td>
    </tr>

    <!-- Disclaimer Footer -->
    <tr>
      <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px">
        <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em">Notice & Confidentiality Disclaimer</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5">
          This is an automated transmission generated for testing and verification purposes by ULA BOT. This communication may contain confidential or legally protected information intended solely for the individual or entity named in the 'To' or 'CC' fields. If you received this email in error, please immediately notify the sender and delete all copies. Any unauthorized review, distribution, or duplication is prohibited.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export async function sendTestEmail(rawPayload, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  wait,
} = {}) {
  const parsed = testPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const error = new Error(`Invalid test email request: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    error.status = 400;
    error.code = "invalid-test-email-payload";
    throw error;
  }

  const { to, cc, subject, message } = parsed.data;
  const carbonCopy = cc ? String(cc).trim() : null;
  const provider = getProviderType(env);
  const status = provider === "emailjs" ? getEmailJSStatus(env) : getMicrosoftGraphStatus(env);

  if (!status.configured) {
    const providerLabel = provider === "emailjs" ? "EmailJS" : "Microsoft Graph";
    const error = new Error(`${providerLabel} email is not configured. Missing: ${status.missing.join(", ") || "none"}. Invalid: ${status.invalid.join(", ") || "none"}.`);
    error.status = 503;
    error.code = `${provider === "emailjs" ? "emailjs" : "microsoft-graph"}-unconfigured`;
    throw error;
  }

  const testId = `test_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  const idempotencyKey = `email:test:${testId}`;

  const html = buildTestHtml({
    to,
    cc: carbonCopy,
    subject,
    message,
    provider,
    timestamp,
    testId,
  });

  const templateParams = {
    to_email: to,
    to_name: "Test Recipient",
    cc_email: carbonCopy || "",
    subject,
    message_html: html,
    test_id: testId,
    message_text: message,
    timestamp,
    provider,
  };

  const client = provider === "emailjs"
    ? createEmailJSMailClient({ env, fetchImpl, wait })
    : createMicrosoftGraphMailClient({ env, fetchImpl, wait });

  const result = await client.sendMail({
    to,
    cc: carbonCopy,
    toName: "Test Recipient",
    subject,
    html,
    templateParams,
    idempotencyKey,
  });

  return {
    ok: true,
    status: "sent",
    test_id: testId,
    provider,
    recipient: to,
    cc: carbonCopy,
    subject,
    sent_at: new Date().toISOString(),
    delivery: result,
  };
}
