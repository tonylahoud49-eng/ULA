const responseError = async (response) => {
  const body = await response.json().catch(() => ({}));
  const error = new Error(body.error || `Leave notification failed with HTTP ${response.status}.`);
  error.status = response.status;
  error.code = body.code || "leave-notification-failed";
  error.delivery = body.delivery || null;
  return error;
};

export async function sendLeaveNotification({ event_type, idempotency_key, leave, employee }) {
  const response = await fetch("/api/leave/notifications", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_type, idempotency_key, leave, employee }),
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}
