import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createPostgresRepository } from "../server/db/postgresRepository.mjs";
import { createLeaveEmailService } from "../server/leave/leaveEmailService.mjs";

dotenv.config();

const failures = [];
const requireValue = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) failures.push(`${name} is required.`);
  return value;
};

if (process.env.NODE_ENV !== "production") failures.push("NODE_ENV must be production.");
if (process.env.VITE_SQL_BACKEND !== "true") failures.push("VITE_SQL_BACKEND must be true before building.");
requireValue("DATABASE_URL");
const appBaseUrl = requireValue("APP_BASE_URL");
if (appBaseUrl) {
  try {
    const parsed = new URL(appBaseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) failures.push("APP_BASE_URL must use HTTP or HTTPS.");
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) failures.push("APP_BASE_URL must be the user-facing server URL, not localhost.");
  } catch {
    failures.push("APP_BASE_URL is not a valid URL.");
  }
}

try {
  await fs.access(path.resolve("dist", "index.html"));
} catch {
  failures.push("dist/index.html is missing. Run npm run build.");
}

const uploadsDirectory = path.resolve(".data", "uploads");
try {
  await fs.mkdir(uploadsDirectory, { recursive: true });
  const probe = path.join(uploadsDirectory, `.production-write-check-${crypto.randomUUID()}`);
  await fs.writeFile(probe, "ok", "utf8");
  await fs.rm(probe, { force: true });
} catch (error) {
  failures.push(`Upload storage is not writable: ${error.message}`);
}

let databaseRole = null;
if (process.env.DATABASE_URL) {
  const repository = createPostgresRepository();
  try {
    const readiness = await repository.assertProductionReady();
    databaseRole = readiness.role;
  } catch (error) {
    failures.push(`PostgreSQL is not production-ready: ${error.message}`);
  } finally {
    await repository.close().catch(() => {});
  }
}

const emailStatus = createLeaveEmailService({ env: process.env }).getStatus();
if (!emailStatus.configured) {
  failures.push(`Email delivery is not production-ready. Missing: ${emailStatus.missing.join(", ") || "none"}. Invalid: ${emailStatus.invalid.join(", ") || "none"}.`);
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    storage: "postgresql",
    database_role: databaseRole,
    email_provider: emailStatus.provider,
    app_base_url: appBaseUrl,
    uploads_directory: uploadsDirectory,
  }, null, 2));
}
