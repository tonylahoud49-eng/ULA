import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ANALYSIS_PIPELINE_VERSION = "resumable-v1";
export const jobError = (message, status = 400, code = "analysis-job-error") => Object.assign(new Error(message), { status, code });
const validId = (id) => /^[a-f0-9]{64}$/.test(String(id));
const revive = (_key, value) => value?.type === "Buffer" && Array.isArray(value.data) ? Buffer.from(value.data) : value;

// Atomic files on a persistent local volume. A process lock prevents a second
// Node process on this host from repeating paid work for the same job.
export function createAnalysisJobStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const folder = (id) => {
    if (!validId(id)) throw jobError("Analysis job not found.", 404);
    return path.join(directory, id);
  };
  const artifactPath = (id, name) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid checkpoint name.");
    return path.join(folder(id), `${name}.json`);
  };
  const read = (id, name = "job") => {
    try { return JSON.parse(fs.readFileSync(artifactPath(id, name), "utf8"), revive); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const write = (id, name, value) => {
    fs.mkdirSync(folder(id), { recursive: true });
    const target = artifactPath(id, name);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  };
  const locked = (id) => {
    try {
      const pid = Number(fs.readFileSync(path.join(folder(id), "worker.lock"), "utf8"));
      if (!Number.isInteger(pid) || pid < 1) return true;
      try { process.kill(pid, 0); return true; }
      catch (error) { return error.code !== "ESRCH"; }
    } catch (error) { if (error.code === "ENOENT") return false; throw error; }
  };
  const acquire = (id) => {
    const filename = path.join(folder(id), "worker.lock");
    if (fs.existsSync(filename) && !locked(id)) fs.unlinkSync(filename);
    let fd;
    try { fd = fs.openSync(filename, "wx", 0o600); }
    catch (error) { if (error.code === "EEXIST") return null; throw error; }
    fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
    return () => fs.unlinkSync(filename);
  };
  return {
    read, write, locked, acquire,
    list: () => fs.readdirSync(directory).filter(validId).map((id) => read(id)).filter(Boolean),
    fingerprint: (input) => crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  };
}

export function publicAnalysisJob(job) {
  const completed = job.batches?.filter((batch) => batch.state === "complete").length || 0;
  return {
    id: job.id, claim_id: job.claim_id, provider: job.provider, model: job.model,
    state: job.state, phase: job.phase, message: job.message, error: job.error,
    created_at: job.created_at, updated_at: job.updated_at,
    request_progress: job.request_progress || null,
    active_batch: job.active_batch || [],
    documents: job.manifest.map(({ id, file_name, storage_key, file_url }) => ({ id, file_name, storage_key, file_url })),
    extracted_units: job.extracted_units || 0, total_units: job.units?.length || 0,
    completed_batches: completed, total_batches: job.batches?.length || 0,
    reviewed_pages: (job.batches || []).filter((batch) => batch.state === "complete").reduce((sum, batch) => sum + batch.page_count, 0),
    total_pages: job.total_pages || 0,
    events: job.events || [], usage: job.usage || null,
  };
}
