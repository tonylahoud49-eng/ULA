import { AuthError } from "./authService.mjs";

export const AUTH_COOKIE_NAME = "ula_session";

const parseCookies = (header) => Object.fromEntries(String(header || "").split(";").map((part) => {
  const index = part.indexOf("=");
  if (index < 0) return ["", ""];
  return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}).filter(([key]) => key));

export const sessionTokenFromRequest = (request) => parseCookies(request.headers.cookie)[AUTH_COOKIE_NAME] || null;

const cookieValue = (token, { maxAge = 0, secure = false } = {}) => [
  `${AUTH_COOKIE_NAME}=${encodeURIComponent(token || "")}`,
  "Path=/",
  "HttpOnly",
  "SameSite=Strict",
  `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ...(secure ? ["Secure"] : []),
].join("; ");

const sendError = (response, error) => response.status(Number(error.status) || 500).json({
  error: error.message || "Authentication failed.",
  code: error.code || "auth-error",
});

export function createAuthHttp({ service, sendResetEmail } = {}) {
  if (!service) throw new Error("An authentication service is required.");

  const requireAuth = async (request, response, next) => {
    try {
      request.authUser = await service.authenticate(sessionTokenFromRequest(request));
      return next();
    } catch (error) {
      return sendError(response, error);
    }
  };

  const requireAdmin = (request, response, next) => request.authUser?.role === "admin"
    ? next()
    : sendError(response, new AuthError("Administrator access is required.", { status: 403, code: "admin-required" }));

  const registerRoutes = (app) => {
    app.post("/api/auth/login", async (request, response) => {
      try {
        const result = await service.login(request.body || {});
        response.setHeader("set-cookie", cookieValue(result.token, {
          maxAge: result.expiresInSeconds,
          secure: request.secure || process.env.NODE_ENV === "production",
        }));
        return response.json({ user: result.user });
      } catch (error) {
        return sendError(response, error);
      }
    });

    app.post("/api/auth/logout", async (request, response) => {
      await service.logout(sessionTokenFromRequest(request));
      response.setHeader("set-cookie", cookieValue("", { maxAge: 0, secure: request.secure || process.env.NODE_ENV === "production" }));
      return response.json({ ok: true });
    });

    app.get("/api/auth/me", requireAuth, (request, response) => response.json({ user: request.authUser }));

    app.post("/api/auth/register", (_request, response) => sendError(response, new AuthError(
      "Public registration is disabled. Contact a ULA administrator for access.",
      { status: 403, code: "registration-disabled" },
    )));

    app.post("/api/auth/google", (_request, response) => sendError(response, new AuthError(
      "Google sign-in is disabled. Use your approved ULA email and system password.",
      { status: 403, code: "google-sign-in-disabled" },
    )));

    app.post("/api/auth/password-reset/request", async (request, response) => {
      try {
        const result = await service.requestPasswordReset(request.body?.email);
        if (result.issued && sendResetEmail) {
          await sendResetEmail({ user: result.user, token: result.token });
        }
        return response.json({ ok: true });
      } catch {
        return response.json({ ok: true });
      }
    });

    app.post("/api/auth/password-reset/confirm", async (request, response) => {
      try {
        await service.resetPassword({ token: request.body?.token, password: request.body?.new_password });
        return response.json({ ok: true });
      } catch (error) {
        return sendError(response, error);
      }
    });

    app.get("/api/admin/users", requireAuth, requireAdmin, async (_request, response) => response.json({ users: await service.listUsers() }));
    app.post("/api/admin/users", requireAuth, requireAdmin, async (request, response) => {
      try {
        return response.status(201).json({ user: await service.createUser(request.body || {}) });
      } catch (error) {
        return sendError(response, error);
      }
    });
    app.patch("/api/admin/users/:userId", requireAuth, requireAdmin, async (request, response) => {
      try {
        return response.json({ user: await service.updateUser(request.params.userId, request.body || {}) });
      } catch (error) {
        return sendError(response, error);
      }
    });
    app.post("/api/admin/users/:userId/password", requireAuth, requireAdmin, async (request, response) => {
      try {
        return response.json(await service.setPassword(request.params.userId, request.body?.password));
      } catch (error) {
        return sendError(response, error);
      }
    });
  };

  return { registerRoutes, requireAuth, requireAdmin };
}
