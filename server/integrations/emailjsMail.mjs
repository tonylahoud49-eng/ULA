const REQUIRED_ENVIRONMENT = [
  "EMAILJS_SERVICE_ID",
  "EMAILJS_TEMPLATE_ID",
  "EMAILJS_PUBLIC_KEY",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export class EmailJSError extends Error {
  constructor(message, { status = 502, code = "emailjs-error", retryable = false, providerStatus = null } = {}) {
    super(message);
    this.name = "EmailJSError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}

export function getEmailJSStatus(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT.filter((name) => !String(env[name] || "").trim());
  const invalid = [];
  return {
    provider: "emailjs",
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    service_id: env.EMAILJS_SERVICE_ID ? String(env.EMAILJS_SERVICE_ID).trim() : null,
    template_id: env.EMAILJS_TEMPLATE_ID ? String(env.EMAILJS_TEMPLATE_ID).trim() : null,
    has_private_key: Boolean(String(env.EMAILJS_PRIVATE_KEY || "").trim()),
  };
}

export function createEmailJSMailClient({ env = process.env, fetchImpl = globalThis.fetch, wait = sleep } = {}) {
  const status = getEmailJSStatus(env);
  if (!status.configured) {
    throw new EmailJSError(`EmailJS is not configured. Missing: ${status.missing.join(", ") || "none"}. Invalid: ${status.invalid.join(", ") || "none"}.`, {
      status: 503,
      code: "emailjs-unconfigured",
    });
  }
  if (typeof fetchImpl !== "function") {
    throw new EmailJSError("A fetch implementation is required.", { status: 500, code: "fetch-unavailable" });
  }

  const serviceId = String(env.EMAILJS_SERVICE_ID).trim();
  const templateId = String(env.EMAILJS_TEMPLATE_ID).trim();
  const publicKey = String(env.EMAILJS_PUBLIC_KEY).trim();
  const privateKey = String(env.EMAILJS_PRIVATE_KEY || "").trim();

  const sendMail = async ({ to, cc, toName, subject, html, templateParams = {}, idempotencyKey }) => {
    const recipient = normalizeEmail(to);
    const carbonCopy = cc ? normalizeEmail(cc) : null;
    if (!recipient || !subject || !idempotencyKey) {
      throw new EmailJSError("Recipient, subject, and idempotency key are required.", {
        status: 400,
        code: "invalid-email-payload",
      });
    }

    const payload = {
      service_id: serviceId,
      template_id: templateParams.template_id || templateId,
      user_id: publicKey,
      ...(privateKey ? { accessToken: privateKey } : {}),
      template_params: {
        to_email: recipient,
        to_name: toName || recipient,
        cc_email: carbonCopy || "",
        subject,
        message_html: html,
        idempotency_key: idempotencyKey,
        ...templateParams,
      },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetchImpl("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new EmailJSError(`EmailJS connection failed: ${error.message}`, {
          code: "emailjs-network-error",
          retryable: false,
        });
      }

      if (response.ok) {
        return {
          status: "sent",
          provider: "emailjs",
          provider_status: response.status,
          recipient,
        };
      }

      const responseText = await response.text().catch(() => "");
      const isSecurityBlocked = responseText.includes("non-browser") || responseText.includes("dashboard.emailjs.com/admin/account/security");
      if ((response.status === 429 || response.status >= 500) && attempt < 2 && !isSecurityBlocked) {
        await wait(Math.min(500 * (2 ** attempt), 5000));
        continue;
      }

      let errorMsg = responseText || `EmailJS send failed with HTTP ${response.status}.`;
      if (isSecurityBlocked) {
        errorMsg = "EmailJS non-browser API access is disabled. Please enable 'Allow EmailJS API for non-browser applications' in EmailJS Dashboard > Account > Security.";
      }
      throw new EmailJSError(errorMsg, {
        status: response.status === 400 || isSecurityBlocked ? 400 : 502,
        code: isSecurityBlocked ? "emailjs-non-browser-disabled" : "emailjs-send-error",
        retryable: !isSecurityBlocked && (response.status === 429 || response.status >= 500),
        providerStatus: response.status,
      });
    }

    throw new EmailJSError("EmailJS send exhausted its safe retries.", {
      code: "emailjs-retries-exhausted",
      retryable: true,
    });
  };

  return { sendMail, provider: "emailjs" };
}
