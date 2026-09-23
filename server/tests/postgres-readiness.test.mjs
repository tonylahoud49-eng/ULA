import test from "node:test";
import assert from "node:assert/strict";
import { POSTGRES_RUNTIME_ROLE_INSPECTION_QUERY } from "../db/postgresRepository.mjs";

test("production readiness inspects the PostgreSQL BYPASSRLS role attribute", () => {
  assert.match(POSTGRES_RUNTIME_ROLE_INSPECTION_QUERY, /\brolbypassrls\b/);
  assert.doesNotMatch(POSTGRES_RUNTIME_ROLE_INSPECTION_QUERY, /\brolbypassrl\b/);
});
