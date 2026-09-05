import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { diskDb, UPLOADS_DIR } from "../db/diskDb.mjs";

test("diskDb creates, reads, updates, and deletes entities on disk", async () => {
  const claimNumber = `TEST-2026-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const testClaim = {
    claim_number: claimNumber,
    title: "Test Cargo Loss",
    business_line: "Marine Cargo (Non-Reefer)",
    status: "New",
  };

  // 1. Create
  const created = diskDb.create("Claim", testClaim);
  assert.ok(created.id);
  assert.equal(created.claim_number, claimNumber);

  // 2. Get
  const fetched = diskDb.get("Claim", created.id);
  assert.ok(fetched);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.title, "Test Cargo Loss");

  // 3. List with query
  const list = diskDb.list("Claim", { claim_number: claimNumber });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);

  // 4. Update
  const updated = diskDb.update("Claim", created.id, { status: "Under Review" });
  assert.equal(updated.status, "Under Review");
  const reFetched = diskDb.get("Claim", created.id);
  assert.equal(reFetched.status, "Under Review");

  // 5. Delete
  const deleted = diskDb.delete("Claim", created.id);
  assert.equal(deleted.id, created.id);
  const afterDelete = diskDb.get("Claim", created.id);
  assert.equal(afterDelete, null);
});

test("diskDb handles physical file uploads directory properly", async () => {
  assert.ok(fs.existsSync(UPLOADS_DIR));
  const testFileName = `test_file_${Date.now()}.txt`;
  const testFilePath = path.join(UPLOADS_DIR, testFileName);
  fs.writeFileSync(testFilePath, "Sample file content on server disk", "utf-8");

  assert.ok(fs.existsSync(testFilePath));
  const content = fs.readFileSync(testFilePath, "utf-8");
  assert.equal(content, "Sample file content on server disk");

  fs.unlinkSync(testFilePath);
  assert.ok(!fs.existsSync(testFilePath));
});
