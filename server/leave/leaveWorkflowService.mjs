import { ULA_LEAVE_APPROVER_EMAILS } from "../../src/lib/leaveEmployees.js";

const failedDelivery = (error, previous = {}) => error.delivery || {
  status: "failed",
  attempts: Number(previous.attempts || 0) + 1,
  idempotency_key: previous.idempotency_key,
  error: error.message,
  code: error.code || "leave-email-delivery-failed",
  retryable: error.status !== 400 && error.status !== 403,
  provider_status: error.providerStatus || null,
};

export function createLeaveWorkflowService({ store, emailService }) {
  const deliver = async ({ leave, employee, event, target }) => {
    try {
      const delivery = await emailService.sendEvent({
        ...event,
        leave,
        employee,
        ...(event.event_type === "submitted" ? { review_token: leave.review_token } : {}),
      });
      const request = await store.recordDelivery(leave.id, target, delivery);
      return { request, delivery, email_error: null };
    } catch (error) {
      const delivery = failedDelivery(error, leave.email_delivery?.[target]);
      const request = await store.recordDelivery(leave.id, target, delivery);
      return { request, delivery, email_error: error.message };
    }
  };

  const submit = async (input) => {
    const pending = await store.submit(input);
    const notified = await deliver({ ...pending, target: "admin_notification" });
    return { ...notified, created: pending.created };
  };

  const decide = async (requestId, decision, { actor, reviewToken }) => {
    const transition = await store.decide(requestId, decision, {
      actor,
      reviewToken,
      approverEmails: ULA_LEAVE_APPROVER_EMAILS,
    });
    const notified = await deliver({ ...transition, target: "employee_notification" });
    return { ...notified, employee: transition.employee, changed: transition.changed };
  };

  const retry = async (requestId, target, { actor, reviewToken }) => {
    const stored = await store.emailEvent(requestId, target, {
      actor,
      reviewToken,
      approverEmails: ULA_LEAVE_APPROVER_EMAILS,
    });
    return deliver({ ...stored, target });
  };

  return {
    getState: store.getState,
    createEmployee: store.createEmployee,
    submit,
    decide,
    retry,
  };
}
