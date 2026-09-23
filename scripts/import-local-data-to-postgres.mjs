import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { buildLocalImportPlan, importPlanCounts } from "../server/db/localDataImport.mjs";

dotenv.config();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allowExisting = args.has("--allow-existing");
const dataArgument = process.argv.slice(2).find((argument) => argument.startsWith("--data-dir="));
const dataDirectory = path.resolve(dataArgument ? dataArgument.slice("--data-dir=".length) : process.env.LOCAL_DATA_DIR || ".data");

const readJson = async (filename, fallback, { required = false } = {}) => {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDirectory, filename), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && !required) return fallback;
    throw new Error(`Could not read ${path.join(dataDirectory, filename)}: ${error.message}`);
  }
};

const claimsDb = await readJson("claims_db.json", {}, { required: true });
const authState = await readJson("auth-state.json", {});
const legacyAuth = await readJson("auth_db.json", {});
const plan = buildLocalImportPlan({
  claimsDb,
  authState,
  legacyAuth,
  defaultOwner: process.env.IMPORT_DEFAULT_OWNER || "",
});
for (const document of plan.claimDocuments) {
  const rawKey = String(document.data.storage_key || document.data.file_url || "");
  const key = path.basename(rawKey.replace(/^server-document:/, "").replace(/^\/api\/documents\/file\//, ""));
  if (!key || key.startsWith("idb-document:")) {
    plan.errors.push(`ClaimDocument ${document.id} is not backed by server upload storage.`);
    continue;
  }
  try {
    await fs.access(path.join(dataDirectory, "uploads", key));
  } catch {
    plan.errors.push(`ClaimDocument ${document.id} is missing upload file ${key}.`);
  }
}
const summary = {
  mode: apply ? "apply" : "dry-run",
  data_directory: dataDirectory,
  default_owner_id: plan.defaultOwnerId || null,
  counts: importPlanCounts(plan),
  warnings: plan.warnings,
  errors: plan.errors,
};

console.log(JSON.stringify(summary, null, 2));
if (plan.errors.length) throw new Error("Local data validation failed. No PostgreSQL data was written.");
if (!apply) {
  console.log("Dry run complete. Re-run with --apply after reviewing the counts and warnings.");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to import local data.");
const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const tableNames = [
  "auth_users",
  "employees",
  "claims",
  "claim_documents",
  "report_versions",
  "leave_requests",
  "audit_log",
];
const imported = Object.fromEntries(tableNames.map((name) => [name, 0]));
const roleByUserId = new Map(plan.users.map((user) => [user.id, user.role]));
const setActor = (id, role = "user") => client.query(
  "select set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)",
  [String(id), role],
);
const insert = async (table, sql, params) => {
  const result = await client.query(sql, params);
  imported[table] += result.rowCount;
};

await client.connect();
try {
  const schema = await client.query("select to_regclass('ula.app_settings') as app_settings, to_regclass('ula.auth_users') as auth_users");
  if (!schema.rows[0]?.app_settings || !schema.rows[0]?.auth_users) {
    throw new Error("PostgreSQL migrations are incomplete. Run npm run db:migrate before importing data.");
  }

  await client.query("begin");
  await setActor(plan.defaultOwnerId, "admin");
  const existing = {};
  for (const table of tableNames) {
    const result = await client.query(`select count(*)::int as count from ula.${table}`);
    existing[table] = result.rows[0].count;
  }
  const populated = Object.entries(existing).filter(([, count]) => count > 0);
  if (populated.length && !allowExisting) {
    throw new Error(`Target database is not empty (${populated.map(([name, count]) => `${name}=${count}`).join(", ")}). Use a clean database or explicitly pass --allow-existing.`);
  }

  for (const user of plan.users) {
    await insert("auth_users", "insert into ula.auth_users (id, email, full_name, job_title, password_hash, password_status, status, role, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing", [
      user.id, user.email, user.full_name, user.job_title, user.password_hash, user.password_status, user.status, user.role, user.created_at, user.updated_at,
    ]);
  }

  await setActor(plan.defaultOwnerId, "admin");
  for (const employee of plan.employees) {
    await insert("employees", "insert into ula.employees (id, user_id, data, created_at, updated_at) values ($1,$2,$3,$4,$5) on conflict do nothing", [
      employee.id, employee.user_id, employee.data, employee.created_at, employee.updated_at,
    ]);
  }

  for (const claim of plan.claims) {
    await setActor(claim.owner_id, roleByUserId.get(claim.owner_id) || "user");
    await insert("claims", "insert into ula.claims (id, owner_id, visibility, data, created_at, updated_at) values ($1,$2,$3,$4,$5,$6) on conflict do nothing", [
      claim.id, claim.owner_id, claim.visibility, claim.data, claim.created_at, claim.updated_at,
    ]);
  }

  await setActor(plan.defaultOwnerId, "admin");
  for (const document of plan.claimDocuments) {
    await insert("claim_documents", "insert into ula.claim_documents (id, claim_id, data, created_at, updated_at) values ($1,$2,$3,$4,$5) on conflict do nothing", [
      document.id, document.claim_id, document.data, document.created_at, document.updated_at,
    ]);
  }
  for (const report of plan.reportVersions) {
    await insert("report_versions", "insert into ula.report_versions (id, claim_id, data, created_at, updated_at) values ($1,$2,$3,$4,$5) on conflict do nothing", [
      report.id, report.claim_id, report.data, report.created_at, report.updated_at,
    ]);
  }

  for (const leave of plan.leaves) {
    await setActor(leave.user_id, roleByUserId.get(leave.user_id) || "user");
    await insert("leave_requests", "insert into ula.leave_requests (id, employee_id, user_id, data, created_at, updated_at) values ($1,$2,$3,$4,$5,$6) on conflict do nothing", [
      leave.id, leave.employee_id, leave.user_id, leave.data, leave.created_at, leave.updated_at,
    ]);
  }

  for (const entry of plan.audit) {
    await setActor(entry.actor_id, entry.actor_role);
    await insert("audit_log", "insert into ula.audit_log (id, actor_id, actor_role, action, entity, record_id, record_label, before_value, after_value, occurred_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing", [
      entry.id, entry.actor_id, entry.actor_role, entry.action, entry.entity, entry.record_id, entry.record_label, entry.before_value, entry.after_value, entry.occurred_at,
    ]);
  }

  await client.query("commit");
  console.log(JSON.stringify({ ok: true, imported }, null, 2));
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
