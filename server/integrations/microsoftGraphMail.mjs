const REQUIRED_ENVIRONMENT = [
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_SENDER_EMAIL",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

export class MicrosoftGraphError extends Error {
  constructor(message, { status = 502, code = "microsoft-graph-error", retryable = false, providerStatus = null } = {}) {
    super(message);
    this.name = "MicrosoftGraphError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.providerStatus = providerStatus;
  }
}

export function getMicrosoftGraphStatus(env = process.env) {
  const missing = REQUIRED_ENVIRONMENT.filter((name) => !String(env[name] || "").trim());
  const invalid = [];
  if (!missing.includes("MICROSOFT_SENDER_EMAIL") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(env.MICROSOFT_SENDER_EMAIL))) invalid.push("MICROSOFT_SENDER_EMAIL");
  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    sender_email: missing.includes("MICROSOFT_SENDER_EMAIL") ? null : normalizeEmail(env.MICROSOFT_SENDER_EMAIL),
    authentication: "client_credentials",
  };
}

const retryAfterMilliseconds = (response, attempt) => {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * (2 ** attempt), 5_000);
};

export function createMicrosoftGraphMailClient({ env = process.env, fetchImpl = globalThis.fetch, wait = sleep } = {}) {
  const status = getMicrosoftGraphStatus(env);
  if (!status.configured) {
    throw new MicrosoftGraphError(`Microsoft Graph email is not configured. Missing: ${status.missing.join(", ") || "none"}. Invalid: ${status.invalid.join(", ") || "none"}.`, {
      status: 503,
      code: "microsoft-graph-unconfigured",
    });
  }
  if (typeof fetchImpl !== "function") throw new MicrosoftGraphError("A fetch implementation is required.", { status: 500, code: "fetch-unavailable" });

  const tenantId = String(env.MICROSOFT_TENANT_ID).trim();
  const clientId = String(env.MICROSOFT_CLIENT_ID).trim();
  const clientSecret = String(env.MICROSOFT_CLIENT_SECRET).trim();
  const senderEmail = normalizeEmail(env.MICROSOFT_SENDER_EMAIL);
  let token = null;
  let tokenExpiresAt = 0;

  const acquireToken = async (force = false) => {
    if (!force && token && Date.now() < tokenExpiresAt - 60_000) return token;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
    let response;
    try {
      response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error) {
      throw new MicrosoftGraphError(`Microsoft identity token request failed: ${error.message}`, { code: "microsoft-token-network-error", retryable: true });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new MicrosoftGraphError(payload.error_description || payload.error?.message || "Microsoft identity rejected the application credentials.", {
        status: response.status === 400 || response.status === 401 ? 503 : 502,
        code: "microsoft-token-error",
        retryable: response.status === 429 || response.status >= 500,
        providerStatus: response.status,
      });
    }
    token = payload.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return token;
  };

  const sendMail = async ({ to, subject, html, idempotencyKey }) => {
    const recipient = normalizeEmail(to);
    if (!recipient || !subject || !html || !idempotencyKey) {
      throw new MicrosoftGraphError("Recipient, subject, HTML body, and idempotency key are required.", { status: 400, code: "invalid-email-payload" });
    }
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;
    const payload = {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: recipient } }],
        internetMessageHeaders: [{ name: "X-ULA-Idempotency-Key", value: idempotencyKey }],
      },
      saveToSentItems: true,
    };

    let forceTokenRefresh = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${await acquireToken(forceTokenRefresh)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new MicrosoftGraphError(`Microsoft Graph connection failed: ${error.message}`, {
          code: "microsoft-graph-network-error",
          retryable: false,
        });
      }

      if (response.status === 202) return { status: "sent", provider_status: 202, recipient, sender: senderEmail };
      if ((response.status === 401 || response.status === 429) && attempt < 2) {
        forceTokenRefresh = response.status === 401;
        if (forceTokenRefresh) token = null;
        await wait(retryAfterMilliseconds(response, attempt));
        continue;
      }
      const payloadError = await response.json().catch(() => ({}));
      throw new MicrosoftGraphError(payloadError.error?.message || `Microsoft Graph sendMail failed with HTTP ${response.status}.`, {
        code: "microsoft-graph-send-error",
        retryable: response.status === 429 || response.status >= 500,
        providerStatus: response.status,
      });
    }
    throw new MicrosoftGraphError("Microsoft Graph sendMail exhausted its safe retries.", { code: "microsoft-graph-retries-exhausted", retryable: true });
  };

  return { sendMail, senderEmail };
}
