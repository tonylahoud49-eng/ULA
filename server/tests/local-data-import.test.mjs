import assert from "node:assert/strict";
import test from "node:test";
import { buildLocalImportPlan, importPlanCounts } from "../db/localDataImport.mjs";

const fallbackHash = () => `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;

test("local import reconciles legacy user ids and preserves relational ownership", () => {
  const plan = buildLocalImportPlan({
    authState: {
      users: [{
        id: "current-admin",
        email: "admin@example.com",
        full_name: "Current Admin",
        role: "admin",
        status: "approved",
        password_hash: fallbackHash(),
      }],
    },
    legacyAuth: {
      accounts: [{
        id: "legacy-admin",
        email: "ADMIN@example.com",
        full_name: "Legacy Admin",
        role: "admin",
        status: "approved",
        passwordHash: "1".repeat(64),
      }],
    },
    claimsDb: {
      Employee: [{ id: "employee-1", account_id: "legacy-admin", email: "admin@example.com", name: "Current Admin" }],
      Claim: [{ id: "claim-1", owner_id: "legacy-admin", visibility: "public", title: "Imported claim" }],
      ClaimDocument: [{ id: "document-1", claim_id: "claim-1", storage_key: "file.pdf" }],
      ReportVersion: [{ id: "report-1", claim_id: "claim-1", status: "Draft" }],
      Leave: [{ id: "leave-1", employee_id: "employee-1", status: "Pending" }],
      AuditLog: [{ id: "legacy-log", actor_id: "legacy-admin", action: "create", entity: "Claim" }],
      User: [],
    },
    createFallbackPasswordHash: fallbackHash,
  });

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.users.length, 1);
  assert.equal(plan.defaultOwnerId, "current-admin");
  assert.equal(plan.employees[0].user_id, "current-admin");
  assert.equal(plan.employees[0].data.account_id, "current-admin");
  assert.equal(plan.claims[0].owner_id, "current-admin");
  assert.equal(plan.leaves[0].user_id, "current-admin");
  assert.equal(plan.audit[0].actor_id, "current-admin");
  assert.match(plan.audit[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(importPlanCounts(plan), {
    users: 1,
    employees: 1,
    claims: 1,
    claim_documents: 1,
    report_versions: 1,
    leave_requests: 1,
    audit_log: 1,
  });
});

test("local import reports orphaned relational records before writing", () => {
  const plan = buildLocalImportPlan({
    authState: {
      users: [{
        id: "admin-1",
        email: "admin@example.com",
        full_name: "Admin",
        role: "admin",
        status: "approved",
        password_hash: fallbackHash(),
      }],
    },
    claimsDb: {
      Employee: [],
      Claim: [],
      ClaimDocument: [{ id: "document-1", claim_id: "missing-claim" }],
      ReportVersion: [],
      Leave: [{ id: "leave-1", employee_id: "missing-employee" }],
      AuditLog: [],
      User: [],
    },
    createFallbackPasswordHash: fallbackHash,
  });

  assert.equal(plan.errors.length, 2);
  assert.equal(plan.errors.some((message) => /missing claim/.test(message)), true);
  assert.equal(plan.errors.some((message) => /missing employee/.test(message)), true);
});
