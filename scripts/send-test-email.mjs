#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendTestEmail, getEmailDiagnosticsStatus } from "../server/email/emailTestService.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");

if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

const args = process.argv.slice(2);
const to = args[0] || process.env.LEAVE_ADMIN_EMAIL || process.env.MICROSOFT_SENDER_EMAIL;
const cc = args[1] || null;
const customMessage = args.slice(2).join(" ") || undefined;

console.info("\n══════════════════════════════════════════════════════════════════════");
console.info(" 🤖 ULA BOT — Automated Email Dispatch Diagnostics");
console.info("══════════════════════════════════════════════════════════════════════\n");

const diagnostics = getEmailDiagnosticsStatus(process.env);
console.info(`Provider:   ${diagnostics.provider === "emailjs" ? "EmailJS" : "Microsoft Graph"}`);
console.info(`Configured: ${diagnostics.configured ? "YES" : "NO"}`);
if (diagnostics.missing.length > 0) {
  console.info(`Missing:    ${diagnostics.missing.join(", ")}`);
}

if (!to) {
  console.error("\n[Error] No recipient specified.");
  console.info("Usage: node scripts/send-test-email.mjs <to-email> [cc-email] [custom-message]");
  console.info("Example: node scripts/send-test-email.mjs recipient@example.com cc@example.com \"Testing ULA BOT!\"\n");
  process.exit(1);
}

console.info(`\nSending test message...`);
console.info(`To:   ${to}`);
if (cc) console.info(`CC:   ${cc}`);

try {
  const result = await sendTestEmail({
    to,
    cc,
    subject: "[ULA System Test] Automated Email Verification",
    message: customMessage || "This is an automated test message verifying that the ULA email dispatch service and mailbox routing are operational.",
  });

  console.info("\n✅ Test email dispatched successfully!");
  console.info(`Test ID:    ${result.test_id}`);
  console.info(`Provider:   ${result.provider}`);
  console.info(`Sent At:    ${result.sent_at}\n`);
} catch (error) {
  console.error("\n❌ Failed to dispatch test email:");
  console.error(error.message);
  if (error.code) console.error(`Code: ${error.code}`);
  console.error("");
  process.exit(1);
}
