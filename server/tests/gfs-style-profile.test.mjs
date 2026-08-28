import fs from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadApprovedStyleReferences, selectApplicableStyleReferences } from "../ai/referenceLayer.mjs";

const referenceDirectory = fileURLToPath(new URL("../ai/references/", import.meta.url));

test("approved GFS profile contains methodology only and no supplied historical claim facts", async () => {
  const text = await fs.readFile(new URL("../ai/references/gfs-reefer-approved.json", import.meta.url), "utf8");
  const profile = JSON.parse(text);

  assert.equal(profile.approved, true);
  assert.equal(profile.profile_id, "gfs-reefer");
  assert.match(text, /sound cargo and no claim/i);
  assert.match(text, /partial loss/i);
  assert.match(text, /total loss/i);
  assert.match(text, /set point, supply-air, return-air/i);
  assert.match(text, /current evidence/i);
  assert.doesNotMatch(text, /CRG\/1399567|CRG\/1388180|MNBU3108501|SUDU8096008|MAERSK LAMANAI|43,430\.25|260518|260501/i);
});

test("production GFS profile is automatically scoped to GFS-family reefer evidence", async () => {
  const references = await loadApprovedStyleReferences(referenceDirectory);
  const gfsEvidence = [{
    document_id: "current-policy",
    document_name: "current-policy.pdf",
    pages: [{ page: 1, text: "Policy Holder M/s. GLOBAL FOODS SOLUTIONS FZCO. Frozen cargo in a reefer container." }],
  }];
  const otherEvidence = [{
    document_id: "other-policy",
    document_name: "other-policy.pdf",
    pages: [{ page: 1, text: "Policy Holder Other Foods Company. Frozen cargo in a reefer container." }],
  }];

  const gfs = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Reefer/GFS)" }, evidence: gfsEvidence });
  const other = selectApplicableStyleReferences(references, { claim: { business_line: "Marine Cargo (Reefer/GFS)" }, evidence: otherEvidence });

  assert.equal(gfs.some((item) => item.profile_id === "gfs-reefer"), true);
  assert.equal(other.some((item) => item.profile_id === "gfs-reefer"), false);
});
