import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createAuthService, createPasswordHash } from "../auth/authService.mjs";
import { createAuthHttp } from "../auth/authHttp.mjs";

const approvedUser = (overrides = {}) => ({
  id: "user-approved",
  email: "director@unitedlossadjusters.com",
  full_name: "Approved Director",
  job_title: "Director",
  password_hash: createPasswordHash("ApprovedPass123!"),
  password_status: "set",
  status: "approved",
  role: "user",
  ...overrides,
});

const adminUser = () => approvedUser({
  id: "user-admin",
  email: "admin@unitedlossadjusters.com",
  full_name: "System Administrator",
  job_title: "System Administrator",
  password_hash: createPasswordHash("AdminPass123!"),
  role: "admin",
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ula-auth-policy-"));
  const service = createAuthService({
    stateFile: path.join(directory, "auth-state.json"),
    seedUsers: [approvedUser(), adminUser()],
  });
  const app = express();
  app.use(express.json());
  const authHttp = createAuthHttp({ service });
  authHttp.registerRoutes(app);
  app.get("/api/protected", authHttp.requireAuth, (request, response) => response.json({ user: request.authUser }));
  app.get("/api/admin-only", authHttp.requireAuth, authHttp.requireAdmin, (_request, response) => response.json({ ok: true }));
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;
  const close = async () => {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  };
  return { service, baseUrl, close };
}

const login = async (baseUrl, email, password) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] || "";
  return { response, body, cookie };
};

test("approved user with the correct ULA password can log in", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const result = await login(current.baseUrl, "DIRECTOR@unitedlossadjusters.com", "ApprovedPass123!");
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie.startsWith("ula_session="));
  assert.equal(result.body.user.job_title, "Director");
  assert.equal("password_hash" in result.body.user, false);
});

test("unknown email is blocked and public self-registration is disabled", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const denied = await login(current.baseUrl, "unknown@example.com", "ApprovedPass123!");
  assert.equal(denied.response.status, 401);
  assert.equal(denied.body.code, "invalid-credentials");
  const registration = await fetch(`${current.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.com", password: "NewPassword123!" }),
  });
  assert.equal(registration.status, 403);
  assert.equal((await registration.json()).code, "registration-disabled");
  assert.equal((await current.service.listUsers()).length, 2);
});

test("revoked user is blocked immediately on protected APIs", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const signedIn = await login(current.baseUrl, "director@unitedlossadjusters.com", "ApprovedPass123!");
  assert.equal(signedIn.response.status, 200);
  await current.service.updateUser("user-approved", { status: "revoked" });
  const protectedResponse = await fetch(`${current.baseUrl}/api/protected`, { headers: { cookie: signedIn.cookie } });
  assert.equal(protectedResponse.status, 401);
  assert.equal((await protectedResponse.json()).code, "auth-required");
  const relogin = await login(current.baseUrl, "director@unitedlossadjusters.com", "ApprovedPass123!");
  assert.equal(relogin.response.status, 403);
  assert.equal(relogin.body.code, "access-denied");
});

test("approved user can reset the ULA password and revoked or unknown users cannot obtain a valid reset", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const reset = await current.service.requestPasswordReset("director@unitedlossadjusters.com");
  assert.equal(reset.issued, true);
  await current.service.resetPassword({ token: reset.token, password: "UpdatedPass123!" });
  assert.equal((await login(current.baseUrl, "director@unitedlossadjusters.com", "UpdatedPass123!")).response.status, 200);
  assert.equal((await current.service.requestPasswordReset("unknown@example.com")).issued, false);
  await current.service.updateUser("user-approved", { status: "revoked" });
  assert.equal((await current.service.requestPasswordReset("director@unitedlossadjusters.com")).issued, false);
});

test("protected APIs reject unauthenticated and fabricated unknown sessions", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const unauthenticated = await fetch(`${current.baseUrl}/api/protected`);
  assert.equal(unauthenticated.status, 401);
  const unknownSession = await fetch(`${current.baseUrl}/api/protected`, { headers: { cookie: "ula_session=fabricated-token" } });
  assert.equal(unknownSession.status, 401);
});

test("existing role permissions remain unchanged", async (context) => {
  const current = await fixture();
  context.after(current.close);
  const employee = await login(current.baseUrl, "director@unitedlossadjusters.com", "ApprovedPass123!");
  const employeeAdminRoute = await fetch(`${current.baseUrl}/api/admin-only`, { headers: { cookie: employee.cookie } });
  assert.equal(employeeAdminRoute.status, 403);
  assert.equal((await employeeAdminRoute.json()).code, "admin-required");
  const administrator = await login(current.baseUrl, "admin@unitedlossadjusters.com", "AdminPass123!");
  const adminRoute = await fetch(`${current.baseUrl}/api/admin-only`, { headers: { cookie: administrator.cookie } });
  assert.equal(adminRoute.status, 200);
  assert.equal((await adminRoute.json()).ok, true);
});
