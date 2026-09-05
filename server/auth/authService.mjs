import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SEEDED_AUTH_USERS } from "./seedUsers.mjs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const resetLifetimeMs = 30 * 60 * 1000;
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const tokenHash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");
const legacyPasswordHash = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

export class AuthError extends Error {
  constructor(message, { status = 400, code = "auth-error" } = {}) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  full_name: user.full_name,
  job_title: user.job_title || "",
  password_status: user.password_status || "set",
  status: user.status,
  role: user.role,
});

export const createPasswordHash = (password) => {
  const value = String(password || "");
  if (value.length < 8) throw new AuthError("The password must contain at least 8 characters.", { code: "password-too-short" });
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(value, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
};

export const verifyPassword = (password, storedHash) => {
  const value = String(password || "");
  const stored = String(storedHash || "");
  if (stored.startsWith("legacy-sha256$")) {
    const expected = Buffer.from(stored.slice("legacy-sha256$".length), "hex");
    const actual = Buffer.from(legacyPasswordHash(value), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(value, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const defaultState = (seedUsers) => ({
  version: 1,
  users: seedUsers.map((user) => ({ ...user })),
  sessions: {},
  reset_requests: {},
});

export function createAuthService({
  stateFile = path.resolve(".data", "auth-state.json"),
  seedUsers = process.env.NODE_ENV === "production" ? [] : SEEDED_AUTH_USERS,
  now = () => Date.now(),
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
      state = defaultState(seedUsers);
      await writeState(state);
      return state;
    }
    if (!Array.isArray(state.users)) state.users = [];
    if (!state.sessions || typeof state.sessions !== "object") state.sessions = {};
    if (!state.reset_requests || typeof state.reset_requests !== "object") state.reset_requests = {};
    let changed = false;
    for (const seed of seedUsers) {
      if (!state.users.some((user) => normalizeEmail(user.email) === normalizeEmail(seed.email))) {
        state.users.push({ ...seed });
        changed = true;
      }
    }
    if (changed) await writeState(state);
    return state;
  };

  async function writeState(state) {
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporary, stateFile);
  }

  const prune = (state) => {
    const timestamp = now();
    for (const [hash, session] of Object.entries(state.sessions)) {
      if (Number(session.expires_at) <= timestamp) delete state.sessions[hash];
    }
    for (const [hash, request] of Object.entries(state.reset_requests)) {
      if (Number(request.expires_at) <= timestamp) delete state.reset_requests[hash];
    }
  };

  const login = ({ email, password }) => withLock(async () => {
    const state = await readState();
    prune(state);
    const account = state.users.find((user) => normalizeEmail(user.email) === normalizeEmail(email));
    if (!account || !verifyPassword(password, account.password_hash)) {
      throw new AuthError("Invalid email or password.", { status: 401, code: "invalid-credentials" });
    }
    if (account.status !== "approved") {
      throw new AuthError("Access denied. This ULA account is not approved.", { status: 403, code: "access-denied" });
    }
    if (String(account.password_hash).startsWith("legacy-sha256$")) {
      account.password_hash = createPasswordHash(password);
      account.password_status = "set";
      account.password_updated_at = new Date(now()).toISOString();
    }
    const token = crypto.randomBytes(32).toString("base64url");
    state.sessions[tokenHash(token)] = {
      user_id: account.id,
      created_at: now(),
      expires_at: now() + sessionLifetimeMs,
    };
    await writeState(state);
    return { token, user: publicUser(account), expiresInSeconds: Math.floor(sessionLifetimeMs / 1000) };
  });

  const authenticate = (token) => withLock(async () => {
    if (!token) throw new AuthError("Authentication required.", { status: 401, code: "auth-required" });
    const state = await readState();
    prune(state);
    const hash = tokenHash(token);
    const session = state.sessions[hash];
    const account = session && state.users.find((user) => user.id === session.user_id);
    if (!session || !account) {
      delete state.sessions[hash];
      await writeState(state);
      throw new AuthError("Authentication required.", { status: 401, code: "auth-required" });
    }
    if (account.status !== "approved") {
      delete state.sessions[hash];
      await writeState(state);
      throw new AuthError("Access denied. This ULA account has been revoked.", { status: 403, code: "access-revoked" });
    }
    await writeState(state);
    return publicUser(account);
  });

  const logout = (token) => withLock(async () => {
    const state = await readState();
    if (token) delete state.sessions[tokenHash(token)];
    await writeState(state);
    return { ok: true };
  });

  const listUsers = () => withLock(async () => {
    const state = await readState();
    return state.users.map(publicUser);
  });

  const createUser = (values) => withLock(async () => {
    const email = normalizeEmail(values.email);
    if (!emailPattern.test(email)) throw new AuthError("A valid email address is required.", { code: "invalid-email" });
    const state = await readState();
    if (state.users.some((user) => normalizeEmail(user.email) === email)) {
      throw new AuthError("An account with this email already exists.", { status: 409, code: "account-exists" });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      full_name: String(values.full_name || "").trim() || email.split("@")[0],
      job_title: String(values.job_title || "").trim(),
      password_hash: createPasswordHash(values.password),
      password_status: "temporary",
      status: "approved",
      role: values.role === "admin" ? "admin" : "user",
      created_at: new Date(now()).toISOString(),
    };
    state.users.push(user);
    await writeState(state);
    return publicUser(user);
  });

  const updateUser = (userId, updates) => withLock(async () => {
    const state = await readState();
    const user = state.users.find((account) => account.id === userId);
    if (!user) throw new AuthError("Account not found.", { status: 404, code: "account-not-found" });
    if (updates.status !== undefined) user.status = updates.status === "approved" ? "approved" : "revoked";
    if (updates.role !== undefined) user.role = updates.role === "admin" ? "admin" : "user";
    if (updates.full_name !== undefined) user.full_name = String(updates.full_name || "").trim() || user.full_name;
    if (updates.job_title !== undefined) user.job_title = String(updates.job_title || "").trim();
    user.updated_at = new Date(now()).toISOString();
    if (user.status !== "approved") {
      for (const [hash, session] of Object.entries(state.sessions)) {
        if (session.user_id === user.id) delete state.sessions[hash];
      }
      for (const [hash, request] of Object.entries(state.reset_requests)) {
        if (request.user_id === user.id) delete state.reset_requests[hash];
      }
    }
    await writeState(state);
    return publicUser(user);
  });

  const setPassword = (userId, password) => withLock(async () => {
    const state = await readState();
    const user = state.users.find((account) => account.id === userId);
    if (!user) throw new AuthError("Account not found.", { status: 404, code: "account-not-found" });
    if (user.status !== "approved") throw new AuthError("Access denied. This ULA account is not approved.", { status: 403, code: "access-denied" });
    user.password_hash = createPasswordHash(password);
    user.password_status = "set";
    user.password_updated_at = new Date(now()).toISOString();
    for (const [sessionHash, session] of Object.entries(state.sessions)) {
      if (session.user_id === user.id) delete state.sessions[sessionHash];
    }
    await writeState(state);
    return { ok: true };
  });

  const requestPasswordReset = (email) => withLock(async () => {
    const state = await readState();
    prune(state);
    const user = state.users.find((account) => normalizeEmail(account.email) === normalizeEmail(email));
    if (!user || user.status !== "approved") {
      await writeState(state);
      return { ok: true, issued: false };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    state.reset_requests[tokenHash(token)] = { user_id: user.id, expires_at: now() + resetLifetimeMs };
    await writeState(state);
    return { ok: true, issued: true, token, user: publicUser(user) };
  });

  const resetPassword = ({ token, password }) => withLock(async () => {
    const state = await readState();
    prune(state);
    const hash = tokenHash(token);
    const request = state.reset_requests[hash];
    const user = request && state.users.find((account) => account.id === request.user_id);
    if (!request || !user || user.status !== "approved") {
      delete state.reset_requests[hash];
      await writeState(state);
      throw new AuthError("This password reset link is invalid or expired.", { code: "invalid-reset-token" });
    }
    user.password_hash = createPasswordHash(password);
    user.password_status = "set";
    user.password_updated_at = new Date(now()).toISOString();
    delete state.reset_requests[hash];
    await writeState(state);
    return { ok: true };
  });

  return {
    login,
    authenticate,
    logout,
    listUsers,
    createUser,
    updateUser,
    setPassword,
    requestPasswordReset,
    resetPassword,
  };
}
