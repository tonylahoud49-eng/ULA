import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the PostgreSQL connectivity check.");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

try {
  await client.connect();
  const result = await client.query("select current_database() as database, current_user as user, now() as server_time");
  console.log(JSON.stringify({ ok: true, ...result.rows[0] }));
} finally {
  await client.end().catch(() => {});
}