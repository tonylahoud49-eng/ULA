const REQUIRED_ENVIRONMENT = ["RESEND_API_KEY", "LEAVE_EMAIL_FROM"];
const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export function senderAddress(value) {
  const sender = String(value || "").trim();
  const displayNameMatch = sender.match(/^[^<>]+<([^<>]+)>$/);
  return normalizeEmail(displayNameMatch ? displayNameMatch[1] : sender);
}

export class ResendEmailError extends Error {
  constructor(message, { status = 502, code = "resend-email-error", retryable = false, providerStatus = null } = {}) {
    super(message);
    this.name = "ResendEmailError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}

export function getResendStatus(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT.filter((name) => !String(env[name] || "").trim());
  const invalid = [];
  const senderEmail = missing.includes("LEAVE_EMAIL_FROM") ? "" : senderAddress(env.LEAVE_EMAIL_FROM);
  if (senderEmail && !EMAIL_PATTERN.test(senderEmail)) invalid.push("LEAVE_EMAIL_FROM");
  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    provider: "resend",
    sender_email: senderEmail || null,
    testing_sender: senderEmail.endsWith("@resend.dev"),
  };
}

const resendFailure = (response, payload, sender) => {
  const providerMessage = String(payload?.message || payload?.error?.message || "").trim();
  const senderRejected = response.status === 403 && /domain|sender|verif/i.test(providerMessage);
  if (senderRejected) {
    return new ResendEmailError(
      `Resend rejected LEAVE_EMAIL_FROM (${sender}). Verify its sending domain in Resend, then retry the saved notification. ${providerMessage}`,
      { status: 503, code: "resend-sender-unverified", retryable: true, providerStatus: response.status },
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new ResendEmailError(providerMessage || "Resend rejected the server-side API credentials.", {
      status: 503,
      code: "resend-authorization-error",
      retryable: true,
      providerStatus: response.status,
    });
  }
  return new ResendEmailError(providerMessage || `Resend email delivery failed with HTTP ${response.status}.`, {
    code: "resend-send-error",
    retryable: response.status === 429 || response.status >= 500,
    providerStatus: response.status,
  });
};

export function createResendMailClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const status = getResendStatus(env);
  if (!status.configured) {
    throw new ResendEmailError(`Resend email is not configured. Missing: ${status.missing.join(", ") || "none"}. Invalid: ${status.invalid.join(", ") || "none"}.`, {
      status: 503,
      code: "resend-unconfigured",
    });
  }
  if (typeof fetchImpl !== "function") throw new ResendEmailError("A fetch implementation is required.", { status: 500, code: "fetch-unavailable" });

  const apiKey = String(env.RESEND_API_KEY).trim();
  const sender = String(env.LEAVE_EMAIL_FROM).trim();

  const sendMail = async ({ to, subject, html, idempotencyKey }) => {
    const recipients = (Array.isArray(to) ? to : [to])
      .map(normalizeEmail)
      .filter((email, index, values) => EMAIL_PATTERN.test(email) && values.indexOf(email) === index);
    if (!recipients.length || !subject || !html || !idempotencyKey) {
      throw new ResendEmailError("Recipient, subject, HTML body, and idempotency key are required.", { status: 400, code: "invalid-email-payload" });
    }

    let response;
    try {
      response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ from: sender, to: recipients, subject, html }),
      });
    } catch (error) {
      throw new ResendEmailError(`Resend connection failed: ${error.message}`, { code: "resend-network-error", retryable: true });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw resendFailure(response, payload, sender);
    if (!payload.id) {
      throw new ResendEmailError("Resend accepted the request without returning an email ID.", {
        code: "resend-invalid-response",
        retryable: true,
        providerStatus: response.status,
      });
    }
    return {
      status: "sent",
      provider: "resend",
      provider_status: response.status,
      provider_message_id: payload.id,
      recipients,
      sender,
    };
  };

  return { sendMail, senderEmail: status.sender_email };
}
