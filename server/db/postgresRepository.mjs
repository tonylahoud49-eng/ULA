import crypto from "node:crypto";
import pg from "pg";
import { createPendingLeave, recordLeaveEmailDelivery, transitionLeave } from "../../src/lib/leaveWorkflow.js";
import { AuthError, createPasswordHash, publicUser, verifyPassword } from "../auth/authService.mjs";

const { Pool } = pg;

const tables = Object.freeze({
  Employee: { table: "ula.employees", id: "id", userId: "user_id" },
  Claim: { table: "ula.claims", id: "id", ownerId: "owner_id", visibility: "visibility" },
  ClaimDocument: { table: "ula.claim_documents", id: "id", claimId: "claim_id" },
  ReportVersion: { table: "ula.report_versions", id: "id", claimId: "claim_id" },
  Leave: { table: "ula.leave_requests", id: "id", userId: "user_id", employeeId: "employee_id" },
  AuditLog: { table: "ula.audit_log", id: "id" },
});

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const badRequest = (message, code = "invalid-request", status = 400) => Object.assign(new Error(message), { code, status });
const tableFor = (entity) => {
  const table = tables[entity];
  if (!table) throw badRequest("Unknown database entity.", "unknown-entity");
  return table;
};

const rowData = (row) => ({
  ...(row.data || {}),
  id: row.id,
  ...(row.owner_id ? { owner_id: row.owner_id } : {}),
  ...(row.visibility ? { visibility: row.visibility } : {}),
  ...(row.user_id ? { user_id: row.user_id } : {}),
  ...(row.employee_id ? { employee_id: row.employee_id } : {}),
  created_date: row.created_at || row.created_date,
  updated_date: row.updated_at || row.updated_date,
});

export function createPostgresRepository({ connectionString = process.env.DATABASE_URL, ssl = process.env.DATABASE_SSL === "true" } = {}) {
  if (!connectionString) return null;
  const pool = new Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: true } : undefined, max: Number(process.env.DATABASE_POOL_SIZE || 10) });

  const withActor = async (actor, operation) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)", [actor.id, actor.role]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      // Explicitly reset session variables to prevent connection pool leakage
      await client.query("reset app.user_id; reset app.user_role").catch(() => {});
      client.release();
    }
  };

  const audit = async (client, actor, action, entity, record, before, after) => {
    await client.query(
      "insert into ula.audit_log (id, actor_id, actor_role, action, entity, record_id, record_label, before_value, after_value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [crypto.randomUUID(), actor.id, actor.role, action, entity, record?.id || null, record?.claim_number || record?.title || record?.employee_name || record?.name || record?.file_name || null, before, after],
    );
  };

  const readLeaveState = async (client, { employeeId = null, leaveId = null } = {}) => {
    const employeeQuery = employeeId
      ? client.query("select * from ula.employees where id = $1 for update", [employeeId])
      : client.query("select * from ula.employees for update");
    const leaveQuery = leaveId
      ? client.query("select * from ula.leave_requests where id = $1 for update", [leaveId])
      : client.query("select * from ula.leave_requests for update");
    const [employees, leaves] = await Promise.all([employeeQuery, leaveQuery]);
    return {
      Employee: employees.rows.map(rowData),
      Leave: leaves.rows.map(rowData),
    };
  };

  const list = (entity, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") {
      const { rows } = await client.query("select id, actor_id, actor_role, action, entity, record_id, record_label, before_value, after_value, occurred_at from ula.audit_log order by occurred_at desc limit 1000");
      return rows.map((row) => ({ ...row, timestamp: row.occurred_at, before: row.before_value, after: row.after_value }));
    }
    const { rows } = await client.query(`select * from ${definition.table} order by created_at desc limit 1000`);
    const result = rows.map(rowData);
    await audit(client, actor, "read:list", entity, null, null, { count: result.length });
    return result;
  });

  const get = (entity, id, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") throw badRequest("Audit events are listed, not retrieved individually.", "audit-get-not-supported");
    const { rows } = await client.query(`select * from ${definition.table} where id = $1`, [id]);
    const result = rows[0] ? rowData(rows[0]) : null;
    if (result) await audit(client, actor, "read:get", entity, result, null, null);
    return result;
  });

  const filter = (entity, criteria, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") return list(entity, actor);
    const supported = ["claim_id", "employee_id", "status"];
    const entries = Object.entries(criteria || {}).filter(([key]) => supported.includes(key));
    const clauses = entries.map(([key], index) => key === "status" ? `data->>'status' = $${index + 1}` : `${key} = $${index + 1}`);
    const { rows } = await client.query(`select * from ${definition.table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by created_at desc limit 1000`, entries.map(([, value]) => value));
    const result = rows.map(rowData);
    await audit(client, actor, "read:filter", entity, null, null, { criteria: clone(criteria), count: result.length });
    return result;
  });

  const create = (entity, values, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") throw badRequest("Audit events are created only by the server.", "audit-immutable", 403);
    const id = String(values.id || crypto.randomUUID());
    const data = { ...clone(values), id, created_date: now(), updated_date: now() };
    let query;
    let params;
    if (entity === "Claim") {
      if (!["private", "public"].includes(values.visibility)) throw badRequest("Choose a claim visibility.", "claim-visibility-required");
      data.owner_id = actor.id;
      data.created_by_id = actor.id;
      data.created_by_name = actor.full_name || actor.email;
      query = "insert into ula.claims (id, owner_id, visibility, data) values ($1,$2,$3,$4) returning *";
      params = [id, actor.id, values.visibility, data];
    } else if (entity === "Employee") {
      const userId = actor.role === "admin" ? String(values.user_id || values.account_id || id) : actor.id;
      data.user_id = userId;
      data.account_id = userId;
      query = "insert into ula.employees (id, user_id, data) values ($1,$2,$3) returning *";
      params = [id, userId, data];
    } else if (entity === "Leave") {
      const employeeId = String(values.employee_id || "");
      if (!employeeId) throw badRequest("An employee is required for leave.");
      query = "insert into ula.leave_requests (id, employee_id, user_id, data) values ($1,$2,$3,$4) returning *";
      params = [id, employeeId, actor.id, data];
    } else {
      const claimId = String(values.claim_id || "");
      if (!claimId) throw badRequest("A claim is required for this record.");
      query = `insert into ${definition.table} (id, claim_id, data) values ($1,$2,$3) returning *`;
      params = [id, claimId, data];
    }
    const { rows } = await client.query(query, params);
    const result = rowData(rows[0]);
    return result;
  });

  const update = (entity, id, values, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") throw badRequest("Audit history is append-only.", "audit-immutable", 403);
    if (entity === "Leave") throw badRequest("Leave requests are updated only through the secured leave workflow.", "leave-workflow-required", 403);
    const { rows: existingRows } = await client.query(`select * from ${definition.table} where id = $1`, [id]);
    if (!existingRows[0]) return null;
    const before = rowData(existingRows[0]);
    const data = { ...before, ...clone(values), id, updated_date: now() };
    let query = `update ${definition.table} set data = $2, updated_at = now() where id = $1 returning *`;
    let params = [id, data];
    if (entity === "Claim") {
      if (values.owner_id && values.owner_id !== before.owner_id) throw badRequest("Claim ownership cannot be changed.", "claim-owner-immutable", 403);
      if (values.visibility && !["private", "public"].includes(values.visibility)) throw badRequest("Choose a valid claim visibility.");
      query = "update ula.claims set visibility = $2, data = $3, updated_at = now() where id = $1 returning *";
      params = [id, data.visibility || before.visibility, data];
    }
    const { rows } = await client.query(query, params);
    const result = rows[0] ? rowData(rows[0]) : null;
    return result;
  });

  const remove = (entity, id, actor) => withActor(actor, async (client) => {
    const definition = tableFor(entity);
    if (entity === "AuditLog") throw badRequest("Audit history is append-only.", "audit-immutable", 403);
    const { rows } = await client.query(`delete from ${definition.table} where id = $1 returning *`, [id]);
    const result = rows[0] ? rowData(rows[0]) : null;
    return result;
  });

  const submitLeave = (values, actor) => withActor(actor, async (client) => {
    const employeeId = String(values?.employee_id || "");
    if (!employeeId) throw badRequest("An employee is required for leave.", "employee-required");
    const state = await readLeaveState(client, { employeeId });
    const result = createPendingLeave(state, values || {}, { id: String(values?.request_id || crypto.randomUUID()) });
    if (!result.created) return { ...result, leave: clone(result.leave), employee: clone(result.employee) };
    const leave = result.leave;
    const { rows } = await client.query(
      "insert into ula.leave_requests (id, employee_id, user_id, data) values ($1,$2,$3,$4) returning *",
      [leave.id, leave.employee_id, actor.id, leave],
    );
    return { ...result, leave: rowData(rows[0]), employee: clone(result.employee) };
  });

  const decideLeave = (requestId, decision, actor) => withActor(actor, async (client) => {
    if (actor.role !== "admin") throw badRequest("Only an administrator can approve or reject leave requests.", "leave-admin-required", 403);
    const initial = await readLeaveState(client, { leaveId: requestId });
    const leave = initial.Leave[0];
    if (!leave) throw badRequest("Leave request not found.", "leave-request-not-found", 404);
    const employeeState = await readLeaveState(client, { employeeId: leave.employee_id, leaveId: requestId });
    const result = transitionLeave(employeeState, requestId, decision, {
      actor: { id: actor.id, name: actor.full_name || actor.email, email: actor.email },
    });
    if (!result.changed) return { ...result, leave: clone(result.leave), employee: clone(result.employee) };
    await client.query("update ula.employees set data = $2, updated_at = now() where id = $1", [result.employee.id, result.employee]);
    const { rows } = await client.query("update ula.leave_requests set data = $2, updated_at = now() where id = $1 returning *", [requestId, result.leave]);
    return { ...result, leave: rowData(rows[0]), employee: clone(result.employee) };
  });

  const recordLeaveDelivery = (requestId, target, delivery, actor) => withActor(actor, async (client) => {
    const state = await readLeaveState(client, { leaveId: requestId });
    if (!state.Leave[0]) throw badRequest("Leave request not found.", "leave-request-not-found", 404);
    const recorded = recordLeaveEmailDelivery(state, requestId, target, delivery);
    const { rows } = await client.query("update ula.leave_requests set data = $2, updated_at = now() where id = $1 returning *", [requestId, recorded.leave]);
    return rowData(rows[0]);
  });

  const getDocumentByStorageKey = (storageKey, actor) => withActor(actor, async (client) => {
    const docQuery = await client.query("select * from ula.claim_documents where data->>'storage_key' = $1 limit 1", [storageKey]);
    if (docQuery.rows[0]) {
      const result = rowData(docQuery.rows[0]);
      await audit(client, actor, "read:download", "ClaimDocument", result, null, { storage_key: storageKey });
      return result;
    }
    const repQuery = await client.query("select * from ula.report_versions where data->>'storage_key' = $1 limit 1", [storageKey]);
    if (repQuery.rows[0]) {
      const result = rowData(repQuery.rows[0]);
      await audit(client, actor, "read:download", "ReportVersion", result, null, { storage_key: storageKey });
      return result;
    }
    return null;
  });

  const recordActivity = (actor, action, entity, record, before = null, after = null) => withActor(actor, async (client) => {
    await audit(client, actor, action, entity, record, before, after);
  });

  const auth = {
    login: async ({ email, password }) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { rows } = await pool.query("select * from ula.auth_users where lower(email) = $1", [normalizedEmail]);
      const account = rows[0];
      if (!account || !verifyPassword(password, account.password_hash)) throw new AuthError("Invalid email or password.", { status: 401, code: "invalid-credentials" });
      if (account.status !== "approved") throw new AuthError("Access denied. This ULA account is not approved.", { status: 403, code: "access-denied" });
      const token = crypto.randomBytes(32).toString("base64url");
      await pool.query("insert into ula.auth_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [crypto.createHash("sha256").update(token).digest("hex"), account.id, new Date(Date.now() + 12 * 60 * 60 * 1000)]);
      return { token, user: publicUser(account), expiresInSeconds: 12 * 60 * 60 };
    },
    authenticate: async (token) => {
      if (!token) throw new AuthError("Authentication required.", { status: 401, code: "auth-required" });
      const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
      const { rows } = await pool.query("select u.* from ula.auth_sessions s join ula.auth_users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()", [tokenHash]);
      if (!rows[0] || rows[0].status !== "approved") {
        await pool.query("delete from ula.auth_sessions where token_hash = $1", [tokenHash]);
        throw new AuthError("Authentication required.", { status: 401, code: "auth-required" });
      }
      return publicUser(rows[0]);
    },
    logout: async (token) => {
      if (token) await pool.query("delete from ula.auth_sessions where token_hash = $1", [crypto.createHash("sha256").update(String(token)).digest("hex")]);
      return { ok: true };
    },
    listUsers: async () => (await pool.query("select * from ula.auth_users order by created_at")).rows.map(publicUser),
    createUser: async (values) => {
      const email = String(values.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("A valid email address is required.", { code: "invalid-email" });
      const user = { id: crypto.randomUUID(), email, full_name: String(values.full_name || "").trim() || email.split("@")[0], job_title: String(values.job_title || "").trim(), password_hash: createPasswordHash(values.password), password_status: "temporary", status: "approved", role: values.role === "admin" ? "admin" : "user" };
      try {
        const { rows } = await pool.query("insert into ula.auth_users (id, email, full_name, job_title, password_hash, password_status, status, role) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *", [user.id, user.email, user.full_name, user.job_title, user.password_hash, user.password_status, user.status, user.role]);
        return publicUser(rows[0]);
      } catch (error) {
        if (error.code === "23505") throw new AuthError("An account with this email already exists.", { status: 409, code: "account-exists" });
        throw error;
      }
    },
    updateUser: async (userId, updates) => {
      const { rows } = await pool.query("update ula.auth_users set status = coalesce($2, status), role = coalesce($3, role), full_name = coalesce($4, full_name), job_title = coalesce($5, job_title), updated_at = now() where id = $1 returning *", [userId, updates.status === undefined ? null : updates.status === "approved" ? "approved" : "revoked", updates.role === undefined ? null : updates.role === "admin" ? "admin" : "user", updates.full_name === undefined ? null : String(updates.full_name || "").trim(), updates.job_title === undefined ? null : String(updates.job_title || "").trim()]);
      if (!rows[0]) throw new AuthError("Account not found.", { status: 404, code: "account-not-found" });
      if (rows[0].status !== "approved") await pool.query("delete from ula.auth_sessions where user_id = $1", [userId]);
      return publicUser(rows[0]);
    },
    setPassword: async (userId, password) => {
      const result = await pool.query("update ula.auth_users set password_hash = $2, password_status = 'set', updated_at = now() where id = $1 and status = 'approved'", [userId, createPasswordHash(password)]);
      if (!result.rowCount) throw new AuthError("Account not found or not approved.", { status: 404, code: "account-not-found" });
      await pool.query("delete from ula.auth_sessions where user_id = $1", [userId]);
      return { ok: true };
    },
    requestPasswordReset: async (email) => {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const { rows } = await pool.query("select * from ula.auth_users where lower(email) = $1 and status = 'approved'", [normalizedEmail]);
      if (!rows[0]) return { ok: true, issued: false };
      const token = crypto.randomBytes(32).toString("base64url");
      await pool.query("insert into ula.password_reset_requests (token_hash, user_id, expires_at) values ($1,$2,$3)", [crypto.createHash("sha256").update(token).digest("hex"), rows[0].id, new Date(Date.now() + 30 * 60 * 1000)]);
      return { ok: true, issued: true, token, user: publicUser(rows[0]) };
    },
    resetPassword: async ({ token, password }) => {
      const tokenHash = crypto.createHash("sha256").update(String(token || "")).digest("hex");
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query("select u.id from ula.password_reset_requests r join ula.auth_users u on u.id = r.user_id where r.token_hash = $1 and r.expires_at > now() and u.status = 'approved' for update", [tokenHash]);
        if (!rows[0]) throw new AuthError("This password reset link is invalid or expired.", { code: "invalid-reset-token" });
        await client.query("update ula.auth_users set password_hash = $2, password_status = 'set', updated_at = now() where id = $1", [rows[0].id, createPasswordHash(password)]);
        await client.query("delete from ula.password_reset_requests where token_hash = $1", [tokenHash]);
        await client.query("delete from ula.auth_sessions where user_id = $1", [rows[0].id]);
        await client.query("commit");
        return { ok: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };

  const createEmployeeAccount = (values, actor) => withActor(actor, async (client) => {
    if (actor.role !== "admin") throw badRequest("Administrator access is required.", "admin-required", 403);
    const email = String(values.email || "").trim().toLowerCase();
    const userId = crypto.randomUUID();
    const employeeId = crypto.randomUUID();
    const fullName = String(values.full_name || "").trim() || email.split("@")[0];
    const jobTitle = String(values.job_title || "").trim();
    const userResult = await client.query("insert into ula.auth_users (id, email, full_name, job_title, password_hash, password_status, status, role) values ($1,$2,$3,$4,$5,'temporary','approved',$6) returning *", [userId, email, fullName, jobTitle, createPasswordHash(values.password), values.role === "admin" ? "admin" : "user"]);
    const employeeResult = await client.query("insert into ula.employees (id, user_id, data) values ($1,$2,$3) returning *", [employeeId, userId, { id: employeeId, account_id: userId, user_id: userId, name: fullName, full_name: fullName, email, designation: jobTitle, department: jobTitle, role: jobTitle, annual_leave_total: 15, annual_leave_used: 0, toil_balance: 0, year: new Date().getFullYear() }]);
    return { account: publicUser(userResult.rows[0]), employee: rowData(employeeResult.rows[0]) };
  });

  return { list, get, filter, create, update, remove, submitLeave, decideLeave, recordLeaveDelivery, getDocumentByStorageKey, recordActivity, createEmployeeAccount, auth, close: () => pool.end(), healthy: async () => { await pool.query("select 1"); return true; } };
}
