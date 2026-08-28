import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createMicrosoftGraphMailClient, getMicrosoftGraphStatus } from "../integrations/microsoftGraphMail.mjs";
import { createEmailJSMailClient, getEmailJSStatus } from "../integrations/emailjsMail.mjs";

const emailSchema = z.string().trim().email();
const leaveSchema = z.object({
  id: z.string().min(1),
  employee_name: z.string().min(1),
  employee_email: emailSchema,
  leave_type: z.enum(["Annual Leave", "TOIL", "TOIL Claim", "Unpaid Leave", "Other Leave", "Other"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().positive(),
  note: z.string().max(4000).optional().default(""),
  status: z.enum(["Pending", "Approved", "Rejected"]),
  submission_balance_snapshot: z.object({
    annual_leave: z.number().nonnegative(),
    toil: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
});
const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: emailSchema,
  annual_leave_total: z.number().nonnegative().optional().default(15),
  annual_leave_used: z.number().nonnegative().optional().default(0),
  toil_balance: z.number().nonnegative().optional().default(0),
});
const eventSchema = z.object({
  event_type: z.enum(["submitted", "approved", "rejected"]),
  idempotency_key: z.string().regex(/^leave:[A-Za-z0-9_-]+:(?:submitted|approved|rejected)$/),
  leave: leaveSchema,
  employee: employeeSchema,
});

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const balances = (employee) => {
  const annual = Math.max(0, Number(employee.annual_leave_total ?? 15) - Number(employee.annual_leave_used ?? 0));
  const toil = Math.max(0, Number(employee.toil_balance ?? 0));
  return { annual, toil, total: annual + toil };
};

const detailTable = (rows) => `<table style="border-collapse:collapse;width:100%;max-width:680px">${rows.map(([label, value]) => `<tr><th style="border:1px solid #d9dde3;padding:8px;text-align:left;background:#f6f7f9">${escapeHtml(label)}</th><td style="border:1px solid #d9dde3;padding:8px">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
const shell = (title, introduction, table, link) => `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#18212b;line-height:1.45"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(introduction)}</p>${table}<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#0b4b78;color:#fff;text-decoration:none;border-radius:4px">Open request in ULA (Feature yet to come)</a></p><p style="color:#667085;font-size:12px">Automated notification from the ULA Annual Leave / TOIL system.</p></body></html>`;

const defaultState = () => ({ events: {} });

const getProviderType = (env = process.env) => {
  const explicit = String(env.LEAVE_EMAIL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "emailjs") return "emailjs";
  if (explicit === "microsoft_graph" || explicit === "graph" || explicit === "microsoft" || explicit === "outlook") return "microsoft_graph";
  if (env.EMAILJS_SERVICE_ID || env.EMAILJS_TEMPLATE_ID || env.EMAILJS_PUBLIC_KEY) return "emailjs";
  return "microsoft_graph";
};

export function createLeaveEmailService({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stateFile = env.LEAVE_MAIL_STATE_FILE || path.resolve(".data", "leave-email-delivery.json"),
  wait,
} = {}) {
  let lock = Promise.resolve();
  const withLock = (operation) => {
    const result = lock.then(operation, operation);
    lock = result.catch(() => {});
    return result;
  };

  const readState = async () => {
    try { return JSON.parse(await fs.readFile(stateFile, "utf8")); } catch (error) {
      if (error.code === "ENOENT") return defaultState();
      throw error;
    }
  };
  const writeState = async (state) => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporary, stateFile);
  };

  const getStatus = () => {
    const provider = getProviderType(env);
    const providerStatus = provider === "emailjs" ? getEmailJSStatus(env) : getMicrosoftGraphStatus(env);
    const missing = [...providerStatus.missing];
    const invalid = [...providerStatus.invalid];
    if (!String(env.LEAVE_ADMIN_EMAIL || "").trim()) missing.push("LEAVE_ADMIN_EMAIL");
    else if (!emailSchema.safeParse(String(env.LEAVE_ADMIN_EMAIL).trim()).success) invalid.push("LEAVE_ADMIN_EMAIL");
    if (String(env.LEAVE_ADMIN_CC_EMAIL || "").trim() && !emailSchema.safeParse(String(env.LEAVE_ADMIN_CC_EMAIL).trim()).success) {
      invalid.push("LEAVE_ADMIN_CC_EMAIL");
    }
    if (!String(env.APP_BASE_URL || "").trim()) missing.push("APP_BASE_URL");
    else {
      try {
        const url = new URL(String(env.APP_BASE_URL));
        if (!['http:', 'https:'].includes(url.protocol)) invalid.push("APP_BASE_URL");
      } catch { invalid.push("APP_BASE_URL"); }
    }
    return {
      provider,
      configured: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
      sender_email: providerStatus.sender_email || null,
    };
  };

  const buildMessage = ({ event_type: eventType, leave, employee }) => {
    const baseUrl = String(env.APP_BASE_URL).replace(/\/+$/, "");
    const link = `${baseUrl}/annual-leave?request=${encodeURIComponent(leave.id)}`;
    const current = eventType === "submitted" ? leave.submission_balance_snapshot : balances(employee);
    const rows = [
      ["Employee", leave.employee_name],
      ["Employee email", leave.employee_email],
      ["Leave type", leave.leave_type],
      ["Start date", leave.start_date],
      ["End date", leave.end_date],
      ["Requested working days", leave.days],
      ["Annual Leave balance", `${current.annual_leave ?? current.annual} days`],
      ["TOIL balance", `${current.toil} days`],
      ["Total available leave", `${current.total} days`],
      ["Employee note / reason", leave.note || "Not provided"],
      ["Request ID", leave.id],
    ];
    const templateParams = {
      employee_name: leave.employee_name,
      employee_email: leave.employee_email,
      leave_type: leave.leave_type,
      start_date: leave.start_date,
      end_date: leave.end_date,
      days: leave.days,
      annual_balance: `${current.annual_leave ?? current.annual} days`,
      toil_balance: `${current.toil} days`,
      total_balance: `${current.total} days`,
      note: leave.note || "Not provided",
      request_id: leave.id,
      link,
      event_type: eventType,
      status: leave.status,
      decision: eventType === "submitted" ? "Pending" : (eventType === "approved" ? "Approved" : "Rejected"),
    };

    if (eventType === "submitted") {
      const isClaim = leave.leave_type === "TOIL Claim";
      const subTitle = isClaim ? `[ULA TOIL] Overtime Claim: ${leave.employee_name} (+${leave.days}d)` : `[ULA Leave] Review required: ${leave.employee_name} — ${leave.leave_type}`;
      const intro = isClaim
        ? `A new TOIL overtime claim (+${leave.days} day(s)) has been submitted by ${leave.employee_name} for manager review.`
        : `A new leave request (${leave.leave_type}) has been saved with Pending status.`;
      return {
        to: String(env.LEAVE_ADMIN_EMAIL).trim(),
        cc: String(env.LEAVE_ADMIN_CC_EMAIL || "").trim() || null,
        toName: "Leave Administrator",
        subject: subTitle,
        html: shell(isClaim ? "TOIL overtime claim awaiting review" : "Leave request awaiting review", intro, detailTable(rows), link),
        templateParams,
      };
    }

    const approved = eventType === "approved";
    let outcomeSubject = `[ULA Leave] Request ${approved ? "approved" : "rejected"}: ${leave.leave_type}`;
    let outcomeIntro = "";

    if (approved) {
      if (leave.leave_type === "TOIL Claim") {
        outcomeSubject = `[ULA TOIL] Overtime Claim Approved (+${leave.days} days credited)`;
        outcomeIntro = `Your TOIL claim was approved and +${leave.days} day(s) have been credited to your TOIL balance.`;
      } else if (leave.leave_type === "Annual Leave") {
        outcomeIntro = `Your Annual Leave request was approved and ${leave.days} day(s) were deducted from your allowance.`;
      } else if (leave.leave_type === "TOIL") {
        outcomeIntro = `Your TOIL request was approved and ${leave.days} day(s) were deducted from your TOIL balance.`;
      } else {
        outcomeIntro = `Your ${leave.leave_type} request was approved and scheduled on the company calendar without balance deduction.`;
      }
    } else {
      outcomeIntro = "Your request was rejected. No leave balances were modified.";
    }

    return {
      to: employee.email,
      toName: employee.name || leave.employee_name,
      subject: outcomeSubject,
      html: shell(
        approved ? `Request Approved: ${leave.leave_type}` : `Request Rejected: ${leave.leave_type}`,
        outcomeIntro,
        detailTable(rows),
        link,
      ),
      templateParams,
    };
  };

  const sendEvent = (rawEvent) => withLock(async () => {
    const parsed = eventSchema.safeParse(rawEvent);
    if (!parsed.success) {
      const error = new Error(`Invalid leave email event: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
      error.status = 400;
      error.code = "invalid-leave-email-event";
      throw error;
    }
    const event = parsed.data;
    const expectedKey = `leave:${event.leave.id}:${event.event_type}`;
    if (event.idempotency_key !== expectedKey) {
      const error = new Error("The leave email idempotency key does not match the request event.");
      error.status = 400;
      error.code = "invalid-idempotency-key";
      throw error;
    }
    if (event.event_type === "submitted" && event.leave.status !== "Pending") {
      const error = new Error("A submission email requires a Pending request.");
      error.status = 409;
      error.code = "leave-event-state-mismatch";
      throw error;
    }
    if (event.event_type !== "submitted" && event.leave.status.toLowerCase() !== event.event_type) {
      const error = new Error("The leave decision email does not match the request status.");
      error.status = 409;
      error.code = "leave-event-state-mismatch";
      throw error;
    }
    const configuration = getStatus();
    const provider = configuration.provider;
    if (!configuration.configured) {
      const providerLabel = provider === "emailjs" ? "EmailJS" : "Microsoft Graph";
      const error = new Error(`${providerLabel} email is not configured. Missing: ${configuration.missing.join(", ") || "none"}. Invalid: ${configuration.invalid.join(", ") || "none"}.`);
      error.status = 503;
      error.code = `${provider === "emailjs" ? "emailjs" : "microsoft-graph"}-unconfigured`;
      throw error;
    }

    const state = await readState();
    const previous = state.events[event.idempotency_key];
    if (previous?.status === "sent") return { ...previous, deduplicated: true };
    if (previous?.status === "sending" && Date.now() - Date.parse(previous.updated_at) < 5 * 60_000) {
      return { ...previous, deduplicated: true };
    }
    const attempts = Number(previous?.attempts || 0) + 1;
    state.events[event.idempotency_key] = { status: "sending", attempts, updated_at: new Date().toISOString() };
    await writeState(state);

    try {
      const client = provider === "emailjs"
        ? createEmailJSMailClient({ env, fetchImpl, wait })
        : createMicrosoftGraphMailClient({ env, fetchImpl, wait });
      const result = await client.sendMail({ ...buildMessage(event), idempotencyKey: event.idempotency_key });
      const delivery = { ...result, attempts, idempotency_key: event.idempotency_key, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.events[event.idempotency_key] = delivery;
      await writeState(state);
      return delivery;
    } catch (error) {
      const delivery = {
        status: "failed",
        provider,
        attempts,
        idempotency_key: event.idempotency_key,
        error: error.message,
        code: error.code || `${provider}-error`,
        retryable: error.retryable === true,
        provider_status: error.providerStatus || null,
        updated_at: new Date().toISOString(),
      };
      state.events[event.idempotency_key] = delivery;
      await writeState(state);
      error.delivery = delivery;
      throw error;
    }
  });

  return { getStatus, sendEvent };
}
