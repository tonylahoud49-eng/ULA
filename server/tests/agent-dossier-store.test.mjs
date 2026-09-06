import test from "node:test";
import assert from "node:assert/strict";
import { getClaimDossier, saveClaimDossier, computeFileHash, clearClaimDossier } from "../ai/agent/dossierStore.mjs";

test("computeFileHash computes sha256 hex string", () => {
  const hash = computeFileHash(Buffer.from("test document content"));
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
});

test("getClaimDossier and saveClaimDossier lifecycle", async () => {
  const claimId = "test-claim-dossier-001";
  await clearClaimDossier(claimId);

  const initial = await getClaimDossier(claimId);
  assert.deepEqual(initial.documents, {});
  assert.equal(initial.claim_id, claimId);

  await saveClaimDossier(claimId, {
    documents: {
      "doc-1": { name: "Invoice.pdf", hash: "abc123hash", extracted_fields: { total: 1000 } }
    },
    reconciliation: { has_shortage: false }
  });

  const updated = await getClaimDossier(claimId);
  assert.ok(updated.documents["doc-1"]);
  assert.equal(updated.documents["doc-1"].name, "Invoice.pdf");
  assert.equal(updated.reconciliation.has_shortage, false);

  await clearClaimDossier(claimId);
});
