import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to run PostgreSQL migrations.");

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
const runtimeRole = process.env.DATABASE_RUNTIME_ROLE || "ula_app";

await client.connect();
try {
  await client.query("create table if not exists public.ula_schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const migrationDirectory = path.resolve("server/db/migrations");
  const files = (await fs.readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await client.query("select 1 from public.ula_schema_migrations where name = $1", [file]);
    if (applied.rowCount) continue;
    await client.query(await fs.readFile(path.join(migrationDirectory, file), "utf8"));
    await client.query("insert into public.ula_schema_migrations (name) values ($1)", [file]);
    console.log(`Applied ${file}`);
  }
  await client.query(`grant usage on schema ula to ${quoteIdentifier(runtimeRole)}`);
  await client.query(`grant select, insert, update, delete on all tables in schema ula to ${quoteIdentifier(runtimeRole)}`);
  await client.query(`grant usage, select on all sequences in schema ula to ${quoteIdentifier(runtimeRole)}`);
  await client.query(`alter default privileges in schema ula grant select, insert, update, delete on tables to ${quoteIdentifier(runtimeRole)}`);
  await client.query(`alter default privileges in schema ula grant usage, select on sequences to ${quoteIdentifier(runtimeRole)}`);
  console.log(`Granted runtime permissions to ${runtimeRole}`);
} finally {
  await client.end();
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("DATABASE_RUNTIME_ROLE must be a simple PostgreSQL identifier.");
  return `"${value}"`;
}
