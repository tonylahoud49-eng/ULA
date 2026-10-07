import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { applyBrainChanges, assertBrainAdmin, brainError, brainMetadata, canReadBrainReport } from "./brainPolicy.mjs";

// Single-process local development only. Production uses PostgreSQL and row locks.
export function createLocalBrainStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const target = (id) => {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid report ID.");
    return path.join(directory, `${id}.json`);
  };
  const get = (id) => {
    try { return JSON.parse(fs.readFileSync(target(id), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const write = (record) => {
    const file = target(record.id);
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(temporary, file);
  };
  const records = () => fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => get(name.slice(0, -5)));
  return {
    list: async (actor) => records().filter((record) => canReadBrainReport(record, actor)).map(brainMetadata).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    get: async (id, actor) => { const record = get(id); return canReadBrainReport(record, actor) ? { ...brainMetadata(record), extracted_text: record.extracted_text, buffer: Buffer.from(record.original_base64, "base64") } : null; },
    insert: async (record, buffer, actor) => {
      if (!actor?.id || record.uploaded_by !== actor.id || record.approval_status !== "submitted" || record.knowledge_manifest) throw brainError("Invalid approved-report submission.", 403);
      const existing = get(record.id);
      if (existing) { if (!canReadBrainReport(existing, actor)) throw brainError("Report not found.", 404); return brainMetadata(existing); }
      write({ ...record, original_base64: buffer.toString("base64") }); return brainMetadata(record);
    },
    mutate: async (id, actor, operation) => {
      assertBrainAdmin(actor);
      const record = get(id);
      if (!record) throw brainError("Saved report not found.", 404);
      const next = applyBrainChanges(record, operation(record));
      write(next); return brainMetadata(next);
    },
    references: async (actor, businessLine = null) => {
      if (!actor?.id) throw brainError("Sign in to retrieve approved methodology.", 401);
      return records().filter((record) => record.approval_status === "verified" && record.status === "active" && record.knowledge_manifest?.approved === true && (!businessLine || record.business_line.toLowerCase() === businessLine.toLowerCase())).map((record) => record.knowledge_manifest).sort((a, b) => a.profile_id.localeCompare(b.profile_id));
    },
  };
}
