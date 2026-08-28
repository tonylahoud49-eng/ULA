import { createEmailJSMailClient } from "../integrations/emailjsMail.mjs";
import { createMicrosoftGraphMailClient } from "../integrations/microsoftGraphMail.mjs";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const providerType = (env) => {
  const explicit = String(env.LEAVE_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "emailjs") return "emailjs";
  if (["microsoft_graph", "graph", "microsoft", "outlook"].includes(explicit)) return "microsoft_graph";
  return env.EMAILJS_SERVICE_ID ? "emailjs" : "microsoft_graph";
};

export async function sendPasswordResetEmail({ user, token }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = String(env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("APP_BASE_URL is required to send a password reset email.");
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const subject = "Reset your ULA Claims Hub password";
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#18212b;line-height:1.5"><h2>Reset your ULA Claims Hub password</h2><p>Hello ${escapeHtml(user.full_name || user.email)},</p><p>A password reset was requested for your approved ULA account.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 16px;background:#218c79;color:#fff;text-decoration:none;border-radius:4px">Reset password</a></p><p>This link expires in 30 minutes. If you did not request it, no action is required.</p><p style="color:#667085;font-size:12px">ULA Claims Hub uses its own password; your Outlook password is not changed.</p></body></html>`;
  const provider = providerType(env);
  const client = provider === "emailjs"
    ? createEmailJSMailClient({ env, fetchImpl })
    : createMicrosoftGraphMailClient({ env, fetchImpl });
  return client.sendMail({
    to: user.email,
    toName: user.full_name || user.email,
    subject,
    html,
    templateParams: {
      to_email: user.email,
      to_name: user.full_name || user.email,
      cc_email: "",
      subject,
      message_html: html,
      employee_email: user.email,
    },
    idempotencyKey: `auth:password-reset:${token.slice(0, 16)}`,
  });
}
