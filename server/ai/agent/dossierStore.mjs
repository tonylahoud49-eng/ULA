import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_ROOT = path.resolve(moduleDir, "../../../.data/dossiers");

export function computeFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function getDossierPath(claimId) {
  const safeId = String(claimId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(DOSSIER_ROOT, `${safeId}.json`);
}

export async function getClaimDossier(claimId) {
  await fs.mkdir(DOSSIER_ROOT, { recursive: true });
  const filePath = getDossierPath(claimId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      claim_id: claimId,
      version: 1,
      updated_at: new Date().toISOString(),
      documents: {},
      reconciliation: null,
      coverage_assessment: null,
      quantum_summary: null,
    };
  }
}

export async function saveClaimDossier(claimId, updates = {}) {
  await fs.mkdir(DOSSIER_ROOT, { recursive: true });
  const existing = await getClaimDossier(claimId);
  const merged = {
    ...existing,
    ...updates,
    documents: {
      ...existing.documents,
      ...(updates.documents || {}),
    },
    updated_at: new Date().toISOString(),
  };
  const filePath = getDossierPath(claimId);
  await fs.writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export async function clearClaimDossier(claimId) {
  const filePath = getDossierPath(claimId);
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore if not exists
  }
}
