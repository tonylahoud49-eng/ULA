import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createPendingLeave,
  eventForLeave,
  recordLeaveEmailDelivery,
  transitionLeave,
} from "../../src/lib/leaveWorkflow.js";
import { normalizeLeaveEmail, seededLeaveEmployees } from "../../src/lib/leaveEmployees.js";

const emailSchema = z.string().trim().email();
const employeeInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: emailSchema,
  role: z.string().trim().max(200).optional().default(""),
  department: z.string().trim().max(200).optional().default(""),
  toil_balance: z.number().nonnegative().optional().default(0),
});
const leaveInputSchema = z.object({
  employee_id: z.string().min(1),
  leave_type: z.enum(["Annual Leave", "TOIL"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(4000).optional().default(""),
  request_id: z.string().min(1).max(200).optional(),
  client_request_id: z.string().min(1).max(200),
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const workflowError = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const defaultState = () => ({ version: 1, Employee: seededLeaveEmployees(), Leave: [] });

const publicLeave = (leave) => {
  const copy = clone(leave);
  delete copy.review_token;
  return copy;
};

export function createLeaveWorkflowStore({
  stateFile = process.env.LEAVE_WORKFLOW_STATE_FILE || path.resolve(".data", "leave-workflow.json"),
} = {}) {
  let lock = Promise.resolve();
  const withLock = (operation) => {
    const result = lock.then(operation, operation);
    lock = result.catch(() => {});
    return result;
  };

  const readState = async () => {
    let state;
    try {
      state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = defaultState();
    }
    if (!Array.isArray(state.Employee)) state.Employee = [];
    if (!Array.isArray(state.Leave)) state.Leave = [];
    const byEmail = new Map(state.Employee.map((employee) => [normalizeLeaveEmail(employee.email), employee]));
    for (const seed of seededLeaveEmployees()) {
      const existing = byEmail.get(normalizeLeaveEmail(seed.email));
      if (existing) {
        existing.name = seed.name;
        existing.email = seed.email;
        existing.role = seed.role;
        existing.department = existing.department || seed.department;
        existing.annual_leave_entitlement_days = Number(existing.annual_leave_entitlement_days ?? 15);
        existing.annual_leave_total = Number(existing.annual_leave_total ?? 15);
        existing.annual_leave_used = Number(existing.annual_leave_used ?? 0);
        existing.annual_leave_year = Number(existing.annual_leave_year ?? new Date().getFullYear());
        existing.toil_balance = Number(existing.toil_balance ?? 0);
      } else {
        state.Employee.push(seed);
        byEmail.set(normalizeLeaveEmail(seed.email), seed);
      }
    }
    state.version = 1;
    return state;
  };

  const writeState = async (state) => {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporary, stateFile);
  };

  const getState = () => withLock(async () => {
    const state = await readState();
    await writeState(state);
    return {
      employees: clone(state.Employee),
      leaves: state.Leave.map(publicLeave),
    };
  });

  const createEmployee = (rawInput) => withLock(async () => {
    const parsed = employeeInputSchema.safeParse(rawInput);
    if (!parsed.success) throw workflowError("Enter a valid employee name, email, role, and TOIL balance.", "invalid-employee", 400);
    const input = parsed.data;
    const state = await readState();
    if (state.Employee.some((employee) => normalizeLeaveEmail(employee.email) === normalizeLeaveEmail(input.email))) {
      throw workflowError("An employee with this email already exists.", "employee-email-duplicate", 409);
    }
    const year = new Date().getFullYear();
    const employee = {
      id: `employee-${crypto.randomUUID()}`,
      name: input.name,
      email: normalizeLeaveEmail(input.email),
      role: input.role || input.department,
      department: input.department || input.role,
      annual_leave_entitlement_days: 15,
      annual_leave_total: 15,
      annual_leave_used: 0,
      annual_leave_year: year,
      toil_balance: input.toil_balance,
      created_date: new Date().toISOString(),
    };
    state.Employee.push(employee);
    await writeState(state);
    return clone(employee);
  });

  const submit = (input) => withLock(async () => {
    const parsed = leaveInputSchema.safeParse(input);
    if (!parsed.success) throw workflowError("Enter a valid employee, leave type, date range, and request ID.", "invalid-leave-request", 400);
    const state = await readState();
    const result = createPendingLeave(state, parsed.data, { id: parsed.data.request_id || crypto.randomUUID() });
    let leave = result.leave;
    if (result.created) {
      leave.review_token = crypto.randomBytes(32).toString("base64url");
      const index = result.database.Leave.findIndex((item) => item.id === leave.id);
      result.database.Leave[index] = leave;
      await writeState(result.database);
    }
    return {
      created: result.created,
      leave: clone(leave),
      employee: clone(result.employee),
      event: eventForLeave(leave, "admin_notification"),
    };
  });

  const recordDelivery = (requestId, target, delivery) => withLock(async () => {
    const state = await readState();
    const recorded = recordLeaveEmailDelivery(state, requestId, target, delivery);
    const internal = state.Leave.find((leave) => leave.id === requestId);
    const updated = recorded.database.Leave.find((leave) => leave.id === requestId);
    if (internal?.review_token) updated.review_token = internal.review_token;
    await writeState(recorded.database);
    return publicLeave(updated);
  });

  const decide = (requestId, decision, { actor, reviewToken, approverEmails }) => withLock(async () => {
    const state = await readState();
    const leave = state.Leave.find((item) => item.id === requestId);
    if (!leave) throw workflowError("Leave request not found.", "leave-request-not-found", 404);
    if (leave.status !== "Pending") {
      throw workflowError(`This request is already ${leave.status.toLowerCase()} and is closed.`, "leave-already-decided", 409);
    }
    const suppliedToken = Buffer.from(String(reviewToken || ""));
    const storedToken = Buffer.from(String(leave.review_token || ""));
    if (!suppliedToken.length || suppliedToken.length !== storedToken.length
      || !crypto.timingSafeEqual(suppliedToken, storedToken)) {
      throw workflowError("This approval link is invalid or expired.", "leave-approval-token-invalid", 403);
    }
    const actorEmail = normalizeLeaveEmail(actor?.email);
    if (!approverEmails.includes(actorEmail)) {
      throw workflowError("Only Annie Abdel Massih or Petro Zaarour can decide this request.", "leave-approver-required", 403);
    }
    const transitioned = transitionLeave(state, requestId, decision, {
      actor: { id: actor?.id || null, name: actor?.name || actor?.full_name || actorEmail, email: actorEmail },
    });
    await writeState(transitioned.database);
    return {
      changed: transitioned.changed,
      leave: clone(transitioned.leave),
      employee: clone(transitioned.employee),
      event: eventForLeave(transitioned.leave, "employee_notification"),
    };
  });

  const emailEvent = (requestId, target, { reviewToken, actor, approverEmails }) => withLock(async () => {
    const state = await readState();
    const leave = state.Leave.find((item) => item.id === requestId);
    if (!leave) throw workflowError("Leave request not found.", "leave-request-not-found", 404);
    const employee = state.Employee.find((item) => item.id === leave.employee_id);
    if (!employee) throw workflowError("Employee not found.", "employee-not-found", 404);
    if (target === "employee_notification") {
      const actorEmail = normalizeLeaveEmail(actor?.email);
      if (!approverEmails.includes(actorEmail) || reviewToken !== leave.review_token) {
        throw workflowError("Only an authorized approver link can retry this email.", "leave-approver-required", 403);
      }
    }
    return { leave: clone(leave), employee: clone(employee), event: eventForLeave(leave, target) };
  });

  return { stateFile, getState, createEmployee, submit, decide, recordDelivery, emailEvent, publicLeave };
}
