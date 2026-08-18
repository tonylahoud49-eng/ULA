import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createMicrosoftGraphMailClient, getMicrosoftGraphStatus } from "../integrations/microsoftGraphMail.mjs";

const emailSchema = z.string().trim().email();
const leaveSchema = z.object({
  id: z.string().min(1),
  employee_name: z.string().min(1),
  employee_email: emailSchema,
  leave_type: z.enum(["Annual Leave", "TOIL"]),
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
const shell = (title, introduction, table, link) => `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#18212b;line-height:1.45"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(introduction)}</p>${table}<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#0b4b78;color:#fff;text-decoration:none;border-radius:4px">Open request in ULA</a></p><p style="color:#667085;font-size:12px">Automated notification from the ULA Annual Leave / TOIL system.</p></body></html>`;

const defaultState = () => ({ events: {} });

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
    const graph = getMicrosoftGraphStatus(env);
    const missing = [...graph.missing];
    const invalid = [...graph.invalid];
    if (!String(env.LEAVE_ADMIN_EMAIL || "").trim()) missing.push("LEAVE_ADMIN_EMAIL");
    else if (!emailSchema.safeParse(String(env.LEAVE_ADMIN_EMAIL).trim()).success) invalid.push("LEAVE_ADMIN_EMAIL");
    if (!String(env.APP_BASE_URL || "").trim()) missing.push("APP_BASE_URL");
    else {
      try {
        const url = new URL(String(env.APP_BASE_URL));
        if (!['http:', 'https:'].includes(url.protocol)) invalid.push("APP_BASE_URL");
      } catch { invalid.push("APP_BASE_URL"); }
    }
    return { configured: missing.length === 0 && invalid.length === 0, missing, invalid, sender_email: graph.sender_email };
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
    if (eventType === "submitted") return {
      to: String(env.LEAVE_ADMIN_EMAIL).trim(),
      subject: `[ULA Leave] Review required: ${leave.employee_name} — ${leave.leave_type}`,
      html: shell("Leave request awaiting review", "A new leave request has been saved with Pending status.", detailTable(rows), link),
    };
    const approved = eventType === "approved";
    return {
      to: employee.email,
      subject: `[ULA Leave] Request ${approved ? "approved" : "rejected"}: ${leave.leave_type}`,
      html: shell(`Leave request ${approved ? "approved" : "rejected"}`, approved ? "Your request was approved and the applicable balance was updated." : "Your request was rejected. No leave balance was deducted.", detailTable(rows), link),
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
    if (!configuration.configured) {
      const error = new Error(`Outlook email is not configured. Missing: ${configuration.missing.join(", ") || "none"}. Invalid: ${configuration.invalid.join(", ") || "none"}.`);
      error.status = 503;
      error.code = "microsoft-graph-unconfigured";
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
      const client = createMicrosoftGraphMailClient({ env, fetchImpl, wait });
      const result = await client.sendMail({ ...buildMessage(event), idempotencyKey: event.idempotency_key });
      const delivery = { ...result, attempts, idempotency_key: event.idempotency_key, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.events[event.idempotency_key] = delivery;
      await writeState(state);
      return delivery;
    } catch (error) {
      const delivery = {
        status: "failed",
        attempts,
        idempotency_key: event.idempotency_key,
        error: error.message,
        code: error.code || "microsoft-graph-error",
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
