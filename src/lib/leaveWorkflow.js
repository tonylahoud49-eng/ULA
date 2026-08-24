export const LEAVE_TYPES = ["Annual Leave", "TOIL", "TOIL Claim", "Unpaid Leave", "Other Leave"];
export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected"];

const clone = (value) => JSON.parse(JSON.stringify(value));
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const finiteDays = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const workflowError = (message, code, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const utcDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

export function calculateWorkingDays(startDate, endDate, holidays = []) {
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  if (!start || !end || end < start) return 0;
  const excluded = new Set(holidays.filter((value) => utcDate(value)));
  let total = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !excluded.has(iso)) total += 1;
  }
  return total;
}

export function leaveBalances(employee = {}) {
  const annualTotal = finiteDays(employee.annual_leave_total ?? 15);
  const annualUsed = finiteDays(employee.annual_leave_used);
  const annualRemaining = Math.max(0, annualTotal - annualUsed);
  const toilRemaining = Math.max(0, finiteDays(employee.toil_balance));
  return {
    annual_leave: annualRemaining,
    toil: toilRemaining,
    total: annualRemaining + toilRemaining,
  };
}

function validateLeaveInput(input, employee) {
  if (!employee) throw workflowError("The selected employee was not found.", "employee-not-found", 404);
  if (!isEmail(employee.email)) throw workflowError("A valid employee email is required before leave can be requested.", "employee-email-required");
  if (!LEAVE_TYPES.includes(input.leave_type)) throw workflowError("Select a valid leave type.", "invalid-leave-type");
  const days = calculateWorkingDays(input.start_date, input.end_date);
  if (days < 1) throw workflowError("Select a valid date range containing at least one working day.", "invalid-leave-dates");
  const balances = leaveBalances(employee);
  if (input.leave_type === "Annual Leave" && days > balances.annual_leave) {
    throw workflowError(`Insufficient Annual Leave balance for this request.`, "insufficient-leave-balance", 409);
  }
  if (input.leave_type === "TOIL" && days > balances.toil) {
    throw workflowError(`Insufficient TOIL balance for this request.`, "insufficient-leave-balance", 409);
  }
  return { days, balances };
}

export function createPendingLeave(database, input, { id, now = new Date().toISOString() } = {}) {
  if (!id) throw workflowError("A request ID is required.", "request-id-required");
  const next = clone(database);
  const duplicate = (next.Leave || []).find((leave) => leave.client_request_id === input.client_request_id && input.client_request_id);
  if (duplicate) return { database: next, leave: duplicate, employee: (next.Employee || []).find((item) => item.id === duplicate.employee_id), created: false };
  const employee = (next.Employee || []).find((item) => item.id === input.employee_id);
  const { days, balances } = validateLeaveInput(input, employee);
  const leave = {
    id,
    employee_id: employee.id,
    employee_name: employee.name,
    employee_email: employee.email,
    leave_type: input.leave_type,
    start_date: input.start_date,
    end_date: input.end_date,
    days,
    note: String(input.note || "").trim(),
    status: "Pending",
    requested_date: now,
    created_date: now,
    updated_date: now,
    client_request_id: input.client_request_id || id,
    submission_balance_snapshot: balances,
    balance_deduction_applied: false,
    email_delivery: {
      admin_notification: {
        event_type: "submitted",
        idempotency_key: `leave:${id}:submitted`,
        status: "pending",
        attempts: 0,
      },
      employee_notification: null,
    },
  };
  next.Leave = [...(next.Leave || []), leave];
  return { database: next, leave, employee, created: true };
}

export function transitionLeave(database, requestId, decision, { now = new Date().toISOString(), actor = null } = {}) {
  if (!['Approved', 'Rejected'].includes(decision)) throw workflowError("Select a valid leave decision.", "invalid-leave-decision");
  const next = clone(database);
  const leaveIndex = (next.Leave || []).findIndex((leave) => leave.id === requestId);
  if (leaveIndex < 0) throw workflowError("Leave request not found.", "leave-request-not-found", 404);
  const leave = next.Leave[leaveIndex];
  const employeeIndex = (next.Employee || []).findIndex((employee) => employee.id === leave.employee_id);
  if (employeeIndex < 0) throw workflowError("The request employee was not found.", "employee-not-found", 404);
  const employee = next.Employee[employeeIndex];
  leave.employee_name = leave.employee_name || employee.name;
  leave.employee_email = leave.employee_email || employee.email;
  leave.note = String(leave.note || "").trim();
  leave.submission_balance_snapshot = leave.submission_balance_snapshot || leaveBalances(employee);

  if (leave.status === decision) {
    const alreadyApplied = decision === "Rejected" || leave.balance_deduction_applied === true || leave.balance_credit_applied === true;
    if (alreadyApplied) return { database: next, leave, employee, changed: false };
  }
  if (leave.status !== "Pending") throw workflowError(`This request is already ${leave.status.toLowerCase()} and cannot be changed.`, "leave-already-decided", 409);

  if (decision === "Approved") {
    const balances = leaveBalances(employee);
    if (leave.leave_type === "Annual Leave") {
      if (leave.days > balances.annual_leave) {
        throw workflowError(`Insufficient Annual Leave balance to approve this request.`, "insufficient-leave-balance", 409);
      }
      employee.annual_leave_used = finiteDays(employee.annual_leave_used) + leave.days;
      leave.balance_deduction_applied = true;
    } else if (leave.leave_type === "TOIL") {
      if (leave.days > balances.toil) {
        throw workflowError(`Insufficient TOIL balance to approve this request.`, "insufficient-leave-balance", 409);
      }
      employee.toil_balance = Math.max(0, finiteDays(employee.toil_balance) - leave.days);
      leave.balance_deduction_applied = true;
    } else if (leave.leave_type === "TOIL Claim") {
      employee.toil_balance = finiteDays(employee.toil_balance) + leave.days;
      leave.balance_credit_applied = true;
    }
    leave.balance_action_id = `leave:${leave.id}:balance`;
    leave.balance_action_at = now;
  }

  leave.status = decision;
  leave.decided_at = now;
  leave.decided_by = actor;
  leave.updated_date = now;
  leave.email_delivery = leave.email_delivery || {};
  leave.email_delivery.employee_notification = {
    event_type: decision === "Approved" ? "approved" : "rejected",
    idempotency_key: `leave:${leave.id}:${decision.toLowerCase()}`,
    status: "pending",
    attempts: 0,
  };
  next.Employee[employeeIndex] = employee;
  next.Leave[leaveIndex] = leave;
  return { database: next, leave, employee, changed: true };
}

export function recordLeaveEmailDelivery(database, requestId, target, delivery, now = new Date().toISOString()) {
  const next = clone(database);
  const leaveIndex = (next.Leave || []).findIndex((leave) => leave.id === requestId);
  if (leaveIndex < 0) throw workflowError("Leave request not found.", "leave-request-not-found", 404);
  if (!['admin_notification', 'employee_notification'].includes(target)) throw workflowError("Invalid email delivery target.", "invalid-email-target");
  const leave = next.Leave[leaveIndex];
  const previous = leave.email_delivery?.[target] || {};
  leave.email_delivery = {
    ...(leave.email_delivery || {}),
    [target]: {
      ...previous,
      ...delivery,
      attempts: Math.max(finiteDays(previous.attempts), finiteDays(delivery.attempts)),
      updated_at: now,
    },
  };
  leave.updated_date = now;
  next.Leave[leaveIndex] = leave;
  return { database: next, leave };
}

export function eventForLeave(leave, target) {
  const delivery = leave.email_delivery?.[target];
  if (!delivery) throw workflowError("This email event is not available for the request.", "email-event-not-available", 409);
  return { event_type: delivery.event_type, idempotency_key: delivery.idempotency_key };
}
