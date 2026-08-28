import { documentStorage } from "@/api/documentStorage";
import { analyzeClaimWithProvider } from "@/api/aiAnalysisClient";
import { createUnifiedReportDraft } from "@/lib/reportingEngine";
import { createEvidenceSnapshots } from "@/lib/evidenceSnapshot";
import { sendLeaveNotification } from "@/api/leaveClient";
import {
  createPendingLeave,
  eventForLeave,
  recordLeaveEmailDelivery,
  transitionLeave,
} from "@/lib/leaveWorkflow";
import { seededLeaveEmployees } from "@/lib/leaveEmployees";

const DATABASE_KEY = "ula_claims_hub_database_v1";

const entityDefaults = {
  Claim: { business_line: "Unclassified", status: "New", priority: "Medium", missing_documents: [] },
  ClaimDocument: { category: "Other" },
  Employee: { annual_leave_total: 15, annual_leave_used: 0, toil_balance: 0 },
  Leave: { status: "Pending" },
  ReportVersion: { status: "Draft" },
  User: {},
};

const emptyDatabase = () => Object.fromEntries(
  Object.keys(entityDefaults).map((name) => [name, []]),
);

const clone = (value) => {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Fallback if value has non-cloneable objects
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const createId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const createError = (message, status = 400, code) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.response = { data: { error: message, code }, status };
  return error;
};

const readJson = (key, fallback) => {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value ? JSON.parse(value) : fallback();
  } catch {
    return fallback();
  }
};

const writeJson = (key, value) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch (error) {
    const quotaExceeded = error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014;
    throw createError(
      quotaExceeded
        ? "Local metadata storage is full. Uploaded file content is stored separately, but older site data may need to be cleared or migrated."
        : "Unable to save local application data. Check that browser site storage is enabled and try again.",
      quotaExceeded ? 507 : 500,
      quotaExceeded ? "metadata-quota-exceeded" : "metadata-storage-error",
    );
  }
};

// In-memory metadata cache. Authentication is authoritative on the server.
let memoryDatabase = null;
const entityMaps = new Map();

const rebuildEntityIndex = (entityName) => {
  const map = new Map();
  const list = memoryDatabase?.[entityName] || [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.id) map.set(list[i].id, list[i]);
  }
  entityMaps.set(entityName, map);
};

const getMemoryDatabase = () => {
  if (!memoryDatabase) {
    memoryDatabase = readJson(DATABASE_KEY, emptyDatabase);
    for (const key of Object.keys(entityDefaults)) {
      if (!Array.isArray(memoryDatabase[key])) memoryDatabase[key] = [];
    }

    let employeesChanged = false;
    const employeeSeeds = seededLeaveEmployees();
    for (const seed of employeeSeeds) {
      const email = String(seed.email || "").trim().toLowerCase();
      const index = memoryDatabase.Employee.findIndex(
        (employee) => String(employee.email || "").trim().toLowerCase() === email,
      );
      if (index < 0) {
        const timestamp = new Date().toISOString();
        memoryDatabase.Employee.push({ ...seed, created_date: timestamp, updated_date: timestamp });
        employeesChanged = true;
        continue;
      }
      const current = memoryDatabase.Employee[index];
      const canonical = {
        ...current,
        name: seed.name,
        email: seed.email,
        account_id: seed.account_id,
        role: seed.role,
        department: seed.department,
      };
      if (JSON.stringify(canonical) !== JSON.stringify(current)) {
        memoryDatabase.Employee[index] = canonical;
        employeesChanged = true;
      }
    }

    for (const key of Object.keys(entityDefaults)) rebuildEntityIndex(key);
    if (employeesChanged) writeJson(DATABASE_KEY, memoryDatabase);
  }
  return memoryDatabase;
};

const saveMemoryDatabase = () => {
  if (memoryDatabase) {
    writeJson(DATABASE_KEY, memoryDatabase);
  }
};

const isDataUrl = (value) => typeof value === "string" && /^data:[^,]*,/i.test(value);

const embeddedDocumentEntry = (document) => Object.entries(document || {}).find(([, value]) => isDataUrl(value));

const assertDocumentMetadataOnly = (values) => {
  if (embeddedDocumentEntry(values)) {
    throw createError(
      "Uploaded file content must be saved through document storage, not in local metadata.",
      400,
      "embedded-document-content",
    );
  }
};

let databasePreparation;

const migrateLegacyDocumentContent = async () => {
  const database = getMemoryDatabase();
  let changed = false;
  const locallyAnalyzedClaimIds = new Set();

  database.Claim = (database.Claim || []).map((claim) => {
    const legacyAnalysis = /local template|local analysis|extracted document text/i.test(claim.ai_classification_source || "");
    if (!legacyAnalysis) return claim;
    locallyAnalyzedClaimIds.add(claim.id);
    const cleaned = { ...claim };
    delete cleaned.ai_confidence;
    delete cleaned.ai_classification_source;
    delete cleaned.ai_suggested_business_line;
    delete cleaned.report_template_id;
    delete cleaned.report_template_name;
    delete cleaned.ai_analyzed_at;
    cleaned.ai_analysis_status = "not-run";
    cleaned.missing_documents = [];
    changed = true;
    return cleaned;
  });

  const documents = database.ClaimDocument || [];

  const migratedDocuments = [];
  for (const originalDocument of documents) {
    const document = { ...originalDocument };
    if (locallyAnalyzedClaimIds.has(document.claim_id)) {
      delete document.detected_categories;
      delete document.detected_category_evidence;
      delete document.content_analysis_basis;
      delete document.content_analysis_provider;
      delete document.content_analysis_warnings;
      delete document.content_analyzed_at;
      delete document.extracted_character_count;
      delete document.extraction_status;
      changed = true;
    }
    const embeddedEntry = embeddedDocumentEntry(document);
    if (!embeddedEntry) {
      migratedDocuments.push(document);
      continue;
    }

    const [, dataUrl] = embeddedEntry;
    const stored = await documentStorage.importDataUrl(dataUrl, {
      storageKey: document.storage_key || document.id,
      name: document.file_name,
      mimeType: document.file_mime_type,
    });
    const metadata = Object.fromEntries(
      Object.entries(document).filter(([, value]) => !isDataUrl(value)),
    );
    migratedDocuments.push({
      ...metadata,
      file_url: stored.reference,
      storage_key: stored.storageKey,
      storage_provider: stored.storageProvider,
      file_size: stored.size,
      file_mime_type: stored.mimeType,
    });
    changed = true;
  }

  if (changed) {
    database.ClaimDocument = migratedDocuments;
    rebuildEntityIndex("Claim");
    rebuildEntityIndex("ClaimDocument");
    saveMemoryDatabase();
  }
};

const prepareDatabase = () => {
  if (!databasePreparation) {
    databasePreparation = migrateLegacyDocumentContent().catch((error) => {
      databasePreparation = undefined;
      throw error;
    });
  }
  return databasePreparation;
};

let activeUser = null;

const authRequest = async (url, options = {}) => {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
    });
  } catch {
    throw createError("The ULA authentication server is unavailable.", 503, "auth-server-unavailable");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) activeUser = null;
    throw createError(body.error || "Authentication failed.", response.status, body.code || "auth-error");
  }
  return body;
};

const requireCurrentUser = async () => {
  const body = await authRequest("/api/auth/me");
  activeUser = body.user;
  return clone(activeUser);
};

const currentUser = () => {
  if (!activeUser) throw createError("Authentication required", 401, "auth-required");
  return clone(activeUser);
};

const createEntityApi = (entityName) => ({
  async list(sort, limit) {
    await requireCurrentUser();
    await prepareDatabase();
    const database = getMemoryDatabase();
    const records = database[entityName] || [];

    if (!sort && !Number.isFinite(limit)) {
      return clone(records);
    }

    let result = [...records];
    if (sort) {
      const descending = sort.startsWith("-");
      const field = descending ? sort.slice(1) : sort;
      result.sort((left, right) => {
        const a = left[field] ?? "";
        const b = right[field] ?? "";
        return (a > b ? 1 : a < b ? -1 : 0) * (descending ? -1 : 1);
      });
    }

    if (Number.isFinite(limit)) result = result.slice(0, limit);
    return clone(result);
  },

  async get(id) {
    await requireCurrentUser();
    await prepareDatabase();
    getMemoryDatabase();
    const record = entityMaps.get(entityName)?.get(id);
    return record ? clone(record) : null;
  },

  async filter(criteria = {}) {
    await requireCurrentUser();
    await prepareDatabase();
    const database = getMemoryDatabase();
    const entries = Object.entries(criteria);
    if (!entries.length) return clone(database[entityName] || []);
    return clone((database[entityName] || []).filter((record) =>
      entries.every(([key, value]) => record[key] === value),
    ));
  },

  async create(values) {
    await requireCurrentUser();
    await prepareDatabase();
    if (entityName === "ClaimDocument") assertDocumentMetadataOnly(values);
    if (entityName === "Leave") throw createError("Leave requests must be created through the validated leave workflow.", 400, "leave-workflow-required");
    const database = getMemoryDatabase();
    const timestamp = new Date().toISOString();
    const record = {
      ...clone(entityDefaults[entityName]),
      ...clone(values),
      id: createId(),
      created_date: timestamp,
      updated_date: timestamp,
    };
    database[entityName] = [...(database[entityName] || []), record];
    entityMaps.get(entityName)?.set(record.id, record);
    saveMemoryDatabase();
    return clone(record);
  },

  async update(id, values) {
    await requireCurrentUser();
    await prepareDatabase();
    if (entityName === "ClaimDocument") assertDocumentMetadataOnly(values);
    if (entityName === "Leave" && values.status && values.status !== "Pending") {
      throw createError("Leave decisions must be made through the validated leave workflow.", 400, "leave-workflow-required");
    }
    if (entityName === "ReportVersion" && (values.status === "Final" || values.issue_state === "Final")) {
      const actor = currentUser();
      if (actor.role !== "admin") {
        throw createError("Only an administrator can approve and issue a final report.", 403, "report-admin-required");
      }
    }
    const database = getMemoryDatabase();
    const records = database[entityName] || [];
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw createError(`${entityName} record not found`, 404);
    const updated = {
      ...records[index],
      ...clone(values),
      id: records[index].id,
      updated_date: new Date().toISOString(),
    };
    records[index] = updated;
    database[entityName] = records;
    entityMaps.get(entityName)?.set(id, updated);
    saveMemoryDatabase();
    return clone(updated);
  },

  async delete(id) {
    await requireCurrentUser();
    await prepareDatabase();
    const database = getMemoryDatabase();
    const deletedRecord = entityMaps.get(entityName)?.get(id) || (database[entityName] || []).find((record) => record.id === id);
    database[entityName] = (database[entityName] || []).filter((record) => record.id !== id);
    entityMaps.get(entityName)?.delete(id);
    saveMemoryDatabase();
    if (entityName === "ClaimDocument" && deletedRecord) {
      await documentStorage.delete(deletedRecord.storage_key || deletedRecord.file_url);
    }
    return { id };
  },
});

const entities = Object.fromEntries(
  Object.keys(entityDefaults).map((name) => [name, createEntityApi(name)]),
);

const auth = {
  me: requireCurrentUser,

  async loginViaEmailPassword(email, password) {
    const body = await authRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    activeUser = body.user;
    return { user: clone(activeUser) };
  },

  async register() {
    throw createError("Public registration is disabled. Contact a ULA administrator for access.", 403, "registration-disabled");
  },

  async loginWithProvider() {
    throw createError("Google sign-in is disabled. Use your approved ULA email and system password.", 403, "google-sign-in-disabled");
  },

  async logout(redirectTo) {
    await authRequest("/api/auth/logout", { method: "POST" }).catch(() => ({}));
    activeUser = null;
    if (redirectTo) globalThis.location.href = redirectTo;
  },

  redirectToLogin(returnTo = "/") {
    const suffix = returnTo && returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    globalThis.location.href = `/login${suffix}`;
  },

  async resetPasswordRequest(email) {
    return authRequest("/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword({ resetToken, newPassword }) {
    return authRequest("/api/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token: resetToken, new_password: newPassword }),
    });
  },

  async listAccounts() {
    const body = await authRequest("/api/admin/users");
    return clone(body.users || []);
  },

  async createAccount({ full_name, email, job_title = "", role = "user", status = "approved", password }) {
    const body = await authRequest("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ full_name, email, job_title, role, status, password }),
    });
    return clone(body.user);
  },

  async createEmployeeAccount({ full_name, email, job_title, role = "user", password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    await prepareDatabase();
    const existingEmployee = (getMemoryDatabase().Employee || []).find(
      (employee) => String(employee.email || "").trim().toLowerCase() === normalizedEmail,
    );
    if (existingEmployee) throw createError("An employee with this email already exists", 409);

    const account = await auth.createAccount({
      full_name,
      email: normalizedEmail,
      job_title,
      role,
      status: "approved",
      password,
    });

    try {
      const employee = await entities.Employee.create({
        account_id: account.id,
        name: full_name?.trim(),
        email: normalizedEmail,
        department: job_title?.trim(),
        role: job_title?.trim(),
        annual_leave_total: 15,
        annual_leave_used: 0,
        toil_balance: 0,
        year: new Date().getFullYear(),
      });
      return { account, employee };
    } catch (error) {
      throw error;
    }
  },

  async setAccountPassword(userId, password) {
    return authRequest(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  async updateAccount(userId, updates) {
    const body = await authRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    return clone(body.user);
  },
};

const buildAnalysis = async ({ claim_id: claimId, provider, model, disable_fallback, on_preflight: onPreflight }) => {
  const claim = await entities.Claim.get(claimId);
  if (!claim) throw createError("Claim not found", 404);
  const documents = await entities.ClaimDocument.filter({ claim_id: claimId });
  if (!documents.length) throw createError("No documents uploaded for this claim");

  const analysis = await analyzeClaimWithProvider({ claim, documents, provider, model, disable_fallback, onPreflight });
  await Promise.all(documents.map((document) => {
    const detections = analysis.document_types
      .map((type) => ({
        category: type.document_type,
        confidence: type.confidence,
        sufficient_information: type.sufficient_information,
        sources: type.sources.filter((source) => source.document_id === document.id),
      }))
      .filter((type) => type.sources.length);
    return entities.ClaimDocument.update(document.id, {
      extraction_status: "complete",
      detected_categories: detections.map((type) => type.category),
      detected_category_evidence: detections.map((type) => ({
        category: type.category,
        confidence: type.confidence,
        sufficient_information: type.sufficient_information,
        excerpts: type.sources.map((source) => source.supporting_text),
        pages: type.sources.map((source) => source.page).filter(Boolean),
      })),
      content_analysis_basis: "ai-content",
      content_analysis_provider: `${analysis.provider}:${analysis.model}`,
      content_analyzed_at: analysis.analyzed_at,
    });
  }));

  const suggestions = analysis.suggested_claim_data || {};
  const claimUpdates = {
    ai_confidence: analysis.confidence,
    ai_classification_source: `${analysis.provider}:${analysis.model}`,
    ai_suggested_business_line: analysis.business_line,
    ai_analysis_status: analysis.status,
    ai_analyzed_at: analysis.analyzed_at,
    ai_suggested_report_template_id: analysis.template_id,
    ai_suggested_report_template_name: analysis.template_name,
    missing_documents: analysis.missing_documents,
    ai_analysis: analysis,
  };

  // Merge suggestions into claim fields only if they are currently empty/null/blank
  // and never overwrite user-entered data
  for (const [key, val] of Object.entries(suggestions)) {
    const currentVal = claim[key];
    const isEmpty = currentVal === undefined || currentVal === null || currentVal === "" || (key === "business_line" && currentVal === "Unclassified");
    if (isEmpty && val !== undefined && val !== null && val !== "") {
      claimUpdates[key] = val;
    }
  }

  await entities.Claim.update(claimId, claimUpdates);
  return { data: { analysis, claim_id: claimId, document_count: documents.length } };
};

const buildReport = async ({ claim_id: claimId, edited_data: editedData }) => {
  const storedClaim = await entities.Claim.get(claimId);
  if (!storedClaim) throw createError("Claim not found", 404);
  const claim = editedData ? { ...storedClaim, ...clone(editedData) } : storedClaim;
  const documents = await entities.ClaimDocument.filter({ claim_id: claimId });
  const versions = await entities.ReportVersion.filter({ claim_id: claimId });
  const user = currentUser();
  const storedEvidence = claim.ai_analysis?.evidence_snapshot;
  const usableStoredEvidence = (item) => {
    if (!item || !Array.isArray(item.pages)) return false;
    if (["failed", "unavailable", "unsupported"].includes(item.extraction_status)) return false;
    return item.pages.some((page) => String(page.text || "").trim())
      || ["vision-only", "vision-required"].includes(item.extraction_status);
  };
  const hasCompleteStoredEvidence = Array.isArray(storedEvidence)
    && documents.every((document) => storedEvidence.some((item) => item.document_id === document.id && usableStoredEvidence(item)));
  const evidence = hasCompleteStoredEvidence
    ? storedEvidence
    : await createEvidenceSnapshots(documents, (storageKey) => documentStorage.get(storageKey));
  const unifiedDraft = createUnifiedReportDraft({
    claim,
    documents,
    versions,
    generatedBy: user.full_name || user.email,
    analysis: claim.ai_analysis,
    evidence,
  });
  const content = unifiedDraft.content;
  const normalizedRecord = {
    ...unifiedDraft.normalizedRecord,
    evidence: evidence.map((item) => ({
      document_id: item.document_id,
      document_name: item.document_name,
      mime_type: item.mime_type,
      extraction_status: item.extraction_status,
      extraction_warning: item.warning || null,
      extracted_content_length: item.pages?.reduce((total, page) => total + String(page.text || "").length, 0) || 0,
    })),
  };
  const factValue = (field) => normalizedRecord.facts[field]?.value ?? null;

  const report = await entities.ReportVersion.create({
    claim_id: claimId,
    version_number: unifiedDraft.versionNumber,
    status: "Draft",
    issue_state: "Draft",
    template_id: unifiedDraft.template.id,
    template_name: unifiedDraft.template.name,
    assignments: unifiedDraft.assignments,
    readiness: {
      overall_progress: unifiedDraft.readiness.overallProgress,
      missing_fields: unifiedDraft.readiness.missingFields,
      missing_documents: unifiedDraft.readiness.missingDocuments,
    },
    evidence_count: documents.length,
    normalized_claim_record: normalizedRecord,
    business_line: normalizedRecord.business_line,
    applicant: factValue("applicant"),
    insured_name: factValue("insured"),
    insurer: factValue("insurer"),
    broker: factValue("broker"),
    policy_number: factValue("policy_number"),
    date_of_loss: factValue("date_of_loss"),
    currency: normalizedRecord.financials.currency,
    claimed_amount: normalizedRecord.financials.presented_claim,
    adjusted_amount: normalizedRecord.financials.concluded_indemnity ?? normalizedRecord.financials.provisional_indemnity,
    human_approval_required: true,
    content,
    generated_by: user.full_name || user.email,
    notes: "Locally generated controlled draft; professional review required",
  });
  await entities.Claim.update(claimId, {
    ...editedData,
    status: "Report Draft",
    normalized_claim_record: normalizedRecord,
  });
  return { data: { report, claim_id: claimId } };
};

const persistLeaveEmailResult = (requestId, target, delivery) => {
  const latest = getMemoryDatabase();
  const recorded = recordLeaveEmailDelivery(latest, requestId, target, delivery);
  memoryDatabase = recorded.database;
  rebuildEntityIndex("Leave");
  saveMemoryDatabase();
  return recorded.leave;
};

const notifyLeave = async (leave, employee, target) => {
  const event = eventForLeave(leave, target);
  try {
    const result = await sendLeaveNotification({ ...event, leave, employee });
    const updatedLeave = persistLeaveEmailResult(leave.id, target, result.delivery);
    return { leave: updatedLeave, delivery: result.delivery, email_error: null };
  } catch (error) {
    const previousAttempts = Number(leave.email_delivery?.[target]?.attempts || 0);
    const delivery = error.delivery || {
      status: "failed",
      attempts: previousAttempts + 1,
      idempotency_key: event.idempotency_key,
      error: error.message,
      code: error.code || "leave-email-delivery-failed",
      retryable: error.status !== 400 && error.status !== 403,
    };
    const updatedLeave = persistLeaveEmailResult(leave.id, target, delivery);
    return { leave: updatedLeave, delivery, email_error: error.message };
  }
};

const submitLeaveRequest = async (payload) => {
  await requireCurrentUser();
  await prepareDatabase();
  const database = getMemoryDatabase();
  const created = createPendingLeave(database, payload, { id: payload.request_id || createId() });
  if (created.created) {
    memoryDatabase = created.database;
    rebuildEntityIndex("Leave");
    saveMemoryDatabase();
  }
  const notified = await notifyLeave(created.leave, created.employee, "admin_notification");
  return { data: { request: notified.leave, delivery: notified.delivery, email_error: notified.email_error, created: created.created } };
};

const decideLeaveRequest = async ({ request_id: requestId, decision }) => {
  await requireCurrentUser();
  await prepareDatabase();
  const database = getMemoryDatabase();
  const actor = currentUser();
  if (actor.role !== "admin") throw createError("Only an administrator can approve or reject leave requests.", 403, "leave-admin-required");
  const transitioned = transitionLeave(database, requestId, decision, {
    actor: { id: actor.id, name: actor.full_name, email: actor.email },
  });
  if (transitioned.changed) {
    memoryDatabase = transitioned.database;
    rebuildEntityIndex("Leave");
    rebuildEntityIndex("Employee");
    saveMemoryDatabase();
  }
  const notified = await notifyLeave(transitioned.leave, transitioned.employee, "employee_notification");
  return { data: { request: notified.leave, employee: transitioned.employee, delivery: notified.delivery, email_error: notified.email_error, changed: transitioned.changed } };
};

const retryLeaveNotification = async ({ request_id: requestId, target }) => {
  await requireCurrentUser();
  await prepareDatabase();
  const actor = currentUser();
  if (actor.role !== "admin") throw createError("Only an administrator can retry leave notification emails.", 403, "leave-admin-required");
  const database = getMemoryDatabase();
  const leave = (database.Leave || []).find((item) => item.id === requestId);
  if (!leave) throw createError("Leave request not found", 404, "leave-request-not-found");
  const employee = (database.Employee || []).find((item) => item.id === leave.employee_id);
  if (!employee) throw createError("Employee not found", 404, "employee-not-found");
  const notified = await notifyLeave(leave, employee, target);
  return { data: { request: notified.leave, delivery: notified.delivery, email_error: notified.email_error } };
};

export const appClient = {
  auth,
  entities,
  documentStorage,
  integrations: {
    Core: {
      async UploadFile({ file }) {
        await requireCurrentUser();
        await prepareDatabase();
        const stored = await documentStorage.save(file);
        return {
          file_url: stored.reference,
          storage_key: stored.storageKey,
          storage_provider: stored.storageProvider,
          file_size: stored.size,
          file_mime_type: stored.mimeType,
        };
      },
      async DeleteFile({ storage_key: storageKey, file_url: fileUrl }) {
        await requireCurrentUser();
        await documentStorage.delete(storageKey || fileUrl);
      },
    },
  },
  functions: {
    async invoke(name, payload) {
      if (name === "analyseClaim") return buildAnalysis(payload);
      if (name === "generateReport") return buildReport(payload);
      if (name === "submitLeaveRequest") return submitLeaveRequest(payload);
      if (name === "decideLeaveRequest") return decideLeaveRequest(payload);
      if (name === "retryLeaveNotification") return retryLeaveNotification(payload);
      throw createError(`Unknown local function: ${name}`, 404);
    },
  },
  consent: {
    async getInfo(handle) {
      if (!handle) throw createError("This authorization link is invalid or expired", 400);
      let authenticated = true;
      try { await requireCurrentUser(); } catch { authenticated = false; }
      return {
        authenticated,
        login_path: "/login",
        client_name: "Local client",
        app_name: "ULA AI Claims Hub",
        tools: [],
      };
    },
    async respond(handle, action) {
      if (!handle || !["approve", "deny"].includes(action)) throw createError("Invalid authorization response");
      return { action };
    },
  },
};
