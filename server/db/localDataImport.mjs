import crypto from "node:crypto";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const validRole = (value) => ["admin", "user", "viewer"].includes(value) ? value : "user";
const validStatus = (value) => value === "revoked" ? "revoked" : "approved";
const dateValue = (value, fallback = new Date(0).toISOString()) => {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
};

const stableUuid = (value) => {
  const input = String(value || "");
  if (uuidPattern.test(input)) return input.toLowerCase();
  const hex = crypto.createHash("sha256").update(input || crypto.randomUUID()).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const passwordHash = (account, createFallbackPasswordHash) => {
  const modern = String(account.password_hash || "");
  if (modern.startsWith("scrypt$") || modern.startsWith("legacy-sha256$")) return modern;
  const legacy = String(account.passwordHash || modern || "");
  if (/^[0-9a-f]{64}$/i.test(legacy)) return `legacy-sha256$${legacy.toLowerCase()}`;
  return createFallbackPasswordHash();
};

const accountRecord = (account, createFallbackPasswordHash) => {
  const email = normalizeEmail(account.email);
  if (!emailPattern.test(email)) return null;
  return {
    id: String(account.id || crypto.randomUUID()),
    email,
    full_name: String(account.full_name || account.name || email.split("@")[0]).trim(),
    job_title: String(account.job_title || account.designation || "").trim(),
    password_hash: passwordHash(account, createFallbackPasswordHash),
    password_status: account.password_status === "temporary" ? "temporary" : "set",
    status: validStatus(account.status),
    role: validRole(account.role),
    created_at: dateValue(account.created_at || account.created_date),
    updated_at: dateValue(account.updated_at || account.updated_date || account.created_at || account.created_date),
  };
};

export function buildLocalImportPlan({
  claimsDb = {},
  authState = {},
  legacyAuth = {},
  defaultOwner = "",
  createFallbackPasswordHash = () => `scrypt$${crypto.randomBytes(16).toString("hex")}$${crypto.randomBytes(64).toString("hex")}`,
} = {}) {
  const warnings = [];
  const errors = [];
  const users = [];
  const usersByEmail = new Map();
  const usersById = new Map();
  const userAliases = new Map();
  const sources = [
    ...(Array.isArray(authState.users) ? authState.users : []),
    ...(Array.isArray(legacyAuth.accounts) ? legacyAuth.accounts : []),
    ...(Array.isArray(claimsDb.User) ? claimsDb.User : []),
  ];

  for (const source of sources) {
    const candidate = accountRecord(source, createFallbackPasswordHash);
    if (!candidate) {
      if (source?.id || source?.email) warnings.push(`Skipped account with invalid email: ${source.email || source.id}.`);
      continue;
    }
    const existing = usersByEmail.get(candidate.email) || usersById.get(candidate.id);
    if (existing) {
      if (source.id) userAliases.set(String(source.id), existing.id);
      continue;
    }
    users.push(candidate);
    usersByEmail.set(candidate.email, candidate);
    usersById.set(candidate.id, candidate);
    userAliases.set(candidate.id, candidate.id);
  }

  const resolveUserId = (id, email) => {
    const requested = String(id || "");
    return userAliases.get(requested)
      || usersById.get(requested)?.id
      || usersByEmail.get(normalizeEmail(email))?.id
      || null;
  };

  const employees = [];
  const employeeIds = new Set();
  const employeeUserIds = new Set();
  for (const original of Array.isArray(claimsDb.Employee) ? claimsDb.Employee : []) {
    const employee = clone(original);
    const id = String(employee.id || crypto.randomUUID());
    let userId = resolveUserId(employee.user_id || employee.account_id, employee.email);
    if (!userId) {
      const email = emailPattern.test(normalizeEmail(employee.email))
        ? normalizeEmail(employee.email)
        : `${id.replace(/[^a-z0-9]/gi, "").toLowerCase() || "employee"}@migration.invalid`;
      const synthetic = accountRecord({
        id: String(employee.user_id || employee.account_id || `import-user-${id}`),
        email,
        full_name: employee.full_name || employee.name,
        job_title: employee.designation || employee.role,
        password_status: "temporary",
        status: "approved",
        role: "user",
        created_at: employee.created_at || employee.created_date,
      }, createFallbackPasswordHash);
      users.push(synthetic);
      usersByEmail.set(synthetic.email, synthetic);
      usersById.set(synthetic.id, synthetic);
      userAliases.set(synthetic.id, synthetic.id);
      userId = synthetic.id;
      warnings.push(`Created a reset-required SQL account for employee ${employee.email || id}.`);
    }
    if (employeeIds.has(id)) {
      errors.push(`Duplicate employee id: ${id}.`);
      continue;
    }
    if (employeeUserIds.has(userId)) {
      errors.push(`More than one employee is linked to user ${userId}.`);
      continue;
    }
    employeeIds.add(id);
    employeeUserIds.add(userId);
    employees.push({
      id,
      user_id: userId,
      data: { ...employee, id, user_id: userId, account_id: userId },
      created_at: dateValue(employee.created_at || employee.created_date),
      updated_at: dateValue(employee.updated_at || employee.updated_date || employee.created_at || employee.created_date),
    });
  }

  const requestedOwner = String(defaultOwner || "").trim();
  const defaultOwnerId = resolveUserId(requestedOwner, requestedOwner)
    || users.find((user) => user.status === "approved" && user.role === "admin")?.id
    || users.find((user) => user.status === "approved")?.id
    || users[0]?.id;
  if (!defaultOwnerId) errors.push("No import account is available to own legacy claims.");

  const claims = [];
  const claimIds = new Set();
  for (const original of Array.isArray(claimsDb.Claim) ? claimsDb.Claim : []) {
    const claim = clone(original);
    const id = String(claim.id || crypto.randomUUID());
    const requestedClaimOwner = claim.owner_id || claim.created_by_id || claim.user_id;
    const ownerId = resolveUserId(requestedClaimOwner, claim.created_by_email) || defaultOwnerId;
    if (!requestedClaimOwner && ownerId) warnings.push(`Assigned legacy claim ${claim.claim_number || id} to ${ownerId}.`);
    const visibility = claim.visibility === "public" ? "public" : "private";
    claimIds.add(id);
    claims.push({
      id,
      owner_id: ownerId,
      visibility,
      data: { ...claim, id, owner_id: ownerId, visibility },
      created_at: dateValue(claim.created_at || claim.created_date),
      updated_at: dateValue(claim.updated_at || claim.updated_date || claim.created_at || claim.created_date),
    });
  }

  const childRows = (name) => {
    const rows = [];
    for (const original of Array.isArray(claimsDb[name]) ? claimsDb[name] : []) {
      const item = clone(original);
      const id = String(item.id || crypto.randomUUID());
      const claimId = String(item.claim_id || "");
      if (!claimIds.has(claimId)) {
        errors.push(`${name} ${id} refers to missing claim ${claimId || "(empty)"}.`);
        continue;
      }
      rows.push({
        id,
        claim_id: claimId,
        data: { ...item, id, claim_id: claimId },
        created_at: dateValue(item.created_at || item.created_date),
        updated_at: dateValue(item.updated_at || item.updated_date || item.created_at || item.created_date),
      });
    }
    return rows;
  };

  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const leaves = [];
  for (const original of Array.isArray(claimsDb.Leave) ? claimsDb.Leave : []) {
    const leave = clone(original);
    const id = String(leave.id || crypto.randomUUID());
    const employeeId = String(leave.employee_id || "");
    const employee = employeeById.get(employeeId);
    if (!employee) {
      errors.push(`Leave ${id} refers to missing employee ${employeeId || "(empty)"}.`);
      continue;
    }
    leaves.push({
      id,
      employee_id: employeeId,
      user_id: employee.user_id,
      data: { ...leave, id, employee_id: employeeId, user_id: employee.user_id },
      created_at: dateValue(leave.created_at || leave.created_date),
      updated_at: dateValue(leave.updated_at || leave.updated_date || leave.created_at || leave.created_date),
    });
  }

  const audit = (Array.isArray(claimsDb.AuditLog) ? claimsDb.AuditLog : []).map((entry, index) => {
    const actorId = resolveUserId(entry.actor_id, entry.actor_email) || defaultOwnerId;
    return {
      id: stableUuid(entry.id || `legacy-audit-${index}`),
      actor_id: actorId,
      actor_role: validRole(entry.actor_role),
      action: String(entry.action || "imported"),
      entity: String(entry.entity || "Unknown"),
      record_id: entry.record_id == null ? null : String(entry.record_id),
      record_label: entry.record_label == null ? null : String(entry.record_label),
      before_value: clone(entry.before ?? entry.before_value ?? null),
      after_value: clone(entry.after ?? entry.after_value ?? null),
      occurred_at: dateValue(entry.occurred_at || entry.timestamp || entry.created_at || entry.created_date),
    };
  });

  return {
    users,
    employees,
    claims,
    claimDocuments: childRows("ClaimDocument"),
    reportVersions: childRows("ReportVersion"),
    leaves,
    audit,
    defaultOwnerId,
    warnings,
    errors,
  };
}

export const importPlanCounts = (plan) => ({
  users: plan.users.length,
  employees: plan.employees.length,
  claims: plan.claims.length,
  claim_documents: plan.claimDocuments.length,
  report_versions: plan.reportVersions.length,
  leave_requests: plan.leaves.length,
  audit_log: plan.audit.length,
});
