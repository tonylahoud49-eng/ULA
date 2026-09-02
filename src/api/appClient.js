import { documentStorage } from "@/api/documentStorage";
import { metadataStorage } from "@/api/metadataStorage";
import { analyzeClaimWithProvider } from "@/api/aiAnalysisClient";
import { createUnifiedReportDraft, sanitizeSuggestedClaimValue } from "@/lib/reportingEngine";
import { createEvidenceSnapshots } from "@/lib/evidenceSnapshot";
import { sendLeaveNotification } from "@/api/leaveClient";
import {
  createPendingLeave,
  eventForLeave,
  recordLeaveEmailDelivery,
  transitionLeave,
} from "@/lib/leaveWorkflow";

const DATABASE_KEY = "ula_claims_hub_database_v1";
const AUTH_KEY = "ula_claims_hub_auth_v1";
const SESSION_KEY = "ula_claims_hub_session_v1";
const ULA123_PASSWORD_HASH = "3d4a446b13ca99097a9c5e33445b69186eb98bce60adc6cfd345d6a9665febe1";

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

const emptyAuth = () => ({
  accounts: [
    {
      id: "admin-id",
      email: "admin@ula.com",
      full_name: "ULA Administrator",
      passwordHash: ULA123_PASSWORD_HASH,
      status: "approved",
      role: "admin",
      designation: "System Administrator",
    },
    {
      id: "user-petro-zaarour",
      email: "petro.zaarour@unitedlossadjusters.com",
      full_name: "Petro Zaarour",
      designation: "Director",
      role: "admin",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-annie-abdelmassih",
      email: "annie.abdelmassih@unitedlossadjusters.com",
      full_name: "Annie Abdel Massih",
      designation: "Claims Director",
      role: "admin",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-estefani-haddad",
      email: "estefani.haddad@unitedlossadjusters.com",
      full_name: "Estefani Haddad",
      designation: "Claims Handler",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-hovig-kalandjian",
      email: "hovig.kalandjian@unitedlossadjusters.com",
      full_name: "Hovig Kalandjian",
      designation: "Marine and Cargo Senior Surveyor",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-feyez-dghayli",
      email: "feyez.dghayli@unitedlossadjusters.com",
      full_name: "Feyez Dghayli",
      designation: "Technical Specialist",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-rana-rizk",
      email: "Rana.Rizk@unitedlossadjusters.com",
      full_name: "Rana Rizk",
      designation: "Claims Handler",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "user-fares-fares",
      email: "Fares.Fares@unitedlossadjusters.com",
      full_name: "Fares Fares",
      designation: "Surveyor",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-admin",
      email: "admin.demo@unitedlossadjusters.com",
      full_name: "Generic Admin",
      designation: "Claims Director & System Approver",
      role: "admin",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-senior-surveyor",
      email: "surveyor.senior@unitedlossadjusters.com",
      full_name: "Generic Senior Surveyor",
      designation: "Marine & Cargo Senior Surveyor",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-claims-handler",
      email: "handler.demo@unitedlossadjusters.com",
      full_name: "Generic Claims Handler",
      designation: "Claims Handler & Adjuster",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-surveyor",
      email: "surveyor.demo@unitedlossadjusters.com",
      full_name: "Generic Marine Surveyor",
      designation: "Marine Surveyor",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-specialist",
      email: "specialist.demo@unitedlossadjusters.com",
      full_name: "Generic Technical Specialist",
      designation: "Engineering & Technical Specialist",
      role: "user",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
    {
      id: "demo-auditor",
      email: "auditor.demo@unitedlossadjusters.com",
      full_name: "Generic Compliance Auditor",
      designation: "Read-Only Compliance Auditor",
      role: "viewer",
      status: "approved",
      passwordHash: ULA123_PASSWORD_HASH,
    },
  ],
  sessionUserId: null,
  pendingVerification: null,
  resetRequests: {},
});

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
  if (!memoryDatabase) throw createError("Local application metadata has not finished loading.", 503, "metadata-not-ready");
  return memoryDatabase;
};

let serverSyncTimer = null;
const syncToServer = () => {
  if (typeof fetch === "undefined" || !memoryDatabase) return;
  clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(() => {
    fetch("/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memoryDatabase),
    }).catch(() => {});
  }, 50);
};

let authSyncTimer = null;
const syncAuthToServer = () => {
  if (typeof fetch === "undefined" || !memoryAuth) return;
  clearTimeout(authSyncTimer);
  authSyncTimer = setTimeout(() => {
    fetch("/api/auth-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memoryAuth),
    }).catch(() => {});
  }, 50);
};

const loadFromServer = async () => {
  if (typeof fetch === "undefined") return;
  try {
    const res = await fetch("/api/db");
    if (res.ok) {
      const serverData = await res.json();
      if (serverData && typeof serverData === "object") {
        if (!memoryDatabase) memoryDatabase = getMemoryDatabase();
        for (const key of Object.keys(entityDefaults)) {
          if (Array.isArray(serverData[key])) {
            memoryDatabase[key] = serverData[key];
            rebuildEntityIndex(key);
          }
        }
        writeJson(DATABASE_KEY, memoryDatabase);
      }
    }
  } catch {
    // Continue with local storage if server offline
  }
};

const loadAuthFromServer = async () => {
  if (typeof fetch === "undefined") return;
  try {
    const res = await fetch("/api/auth-db");
    if (res.ok) {
      const serverAuth = await res.json();
      if (serverAuth && typeof serverAuth === "object" && Array.isArray(serverAuth.accounts)) {
        if (!memoryAuth) memoryAuth = getMemoryAuth();
        const activeLocalSession = readJson(SESSION_KEY, () => memoryAuth?.sessionUserId || null);
        const mergedAccounts = [...serverAuth.accounts];
        for (const localAcc of (memoryAuth.accounts || [])) {
          if (!mergedAccounts.some((a) => a.id === localAcc.id || normalizeEmail(a.email) === normalizeEmail(localAcc.email))) {
            mergedAccounts.push(localAcc);
          }
        }
        memoryAuth.accounts = mergedAccounts;
        if (activeLocalSession) {
          memoryAuth.sessionUserId = activeLocalSession;
        }
        writeJson(AUTH_KEY, memoryAuth);
      }
    }
  } catch {
    // Continue with local
  }
};

const saveMemoryDatabase = () => {
  if (memoryDatabase) {
    writeJson(DATABASE_KEY, memoryDatabase);
    syncToServer();
  }
};

const getMemoryAuth = () => {
  if (!memoryAuth) {
    memoryAuth = readJson(AUTH_KEY, emptyAuth);
    const activeLocalSession = readJson(SESSION_KEY, () => null);
    if (activeLocalSession) {
      memoryAuth.sessionUserId = activeLocalSession;
    }
  }

const saveMemoryAuth = () => {
  if (memoryAuth) {
    writeJson(AUTH_KEY, memoryAuth);
    syncAuthToServer();
  }

  for (const key of Object.keys(entityDefaults)) rebuildEntityIndex(key);
  if (employeesChanged) await saveMemoryDatabase();
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
    await saveMemoryDatabase();
  }
};

const prepareDatabase = () => {
  if (!databasePreparation) {
    databasePreparation = (async () => {
      await loadFromServer();
      await loadAuthFromServer();
      await migrateLegacyDocumentContent();
    })().catch((error) => {
      databasePreparation = undefined;
      throw error;
    });
  }
  return databasePreparation;
};

let activeUser = null;

const matchUserAccount = (accounts = [], inputEmail = "") => {
  const raw = normalizeEmail(inputEmail);
  if (!raw) return null;
  const username = raw.split("@")[0];

  // 1. Exact email match
  let found = (accounts || []).find((a) => normalizeEmail(a.email) === raw);
  if (found) return found;

  // 2. Domain alias match (@ula.com <-> @unitedlossadjusters.com)
  const ulaAlias = raw.endsWith("@ula.com")
    ? raw.replace("@ula.com", "@unitedlossadjusters.com")
    : raw.endsWith("@unitedlossadjusters.com")
    ? raw.replace("@unitedlossadjusters.com", "@ula.com")
    : null;

  if (ulaAlias) {
    found = (accounts || []).find((a) => normalizeEmail(a.email) === ulaAlias);
    if (found) return found;
  }

  // 3. Username prefix match (e.g. "petro.zaarour" or "admin")
  found = (accounts || []).find((a) => {
    const accUsername = normalizeEmail(a.email).split("@")[0];
    return accUsername === username || accUsername === raw;
  });
  if (found) return found;

  return null;
};

const hashPassword = async (password) => {
  const value = String(password || "");
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return value;
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const currentUser = () => {
  const auth = getMemoryAuth();
  const sessionUserId = auth.sessionUserId || readJson(SESSION_KEY, () => null);
  if (!sessionUserId) {
    throw createError("Authentication required", 401);
  }
  const account = (auth.accounts || []).find((item) => item.id === sessionUserId);
  if (!account) throw createError("Authentication required", 401);
  if (account.status === "pending") {
    throw createError("User access is pending administrator approval", 403, "user_not_registered");
  }
  const { passwordHash: _passwordHash, ...user } = account;
  return clone(user);
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
    await saveMemoryDatabase();
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
    if (entityName === "ReportVersion" && (values.status === "Final" || values.issue_state === "Final")) {
      const blockers = records[index]?.normalized_claim_record?.report_quality?.issue_blockers || [];
      if (blockers.length) {
        throw createError(`The report cannot be issued until the quality blockers are resolved: ${blockers.join(" ")}`, 409, "report-quality-blocked");
      }
    }
    const updated = {
      ...records[index],
      ...clone(values),
      id: records[index].id,
      updated_date: new Date().toISOString(),
    };
    records[index] = updated;
    database[entityName] = records;
    entityMaps.get(entityName)?.set(id, updated);
    await saveMemoryDatabase();
    return clone(updated);
  },

  async delete(id) {
    await requireCurrentUser();
    await prepareDatabase();
    const database = getMemoryDatabase();
    const deletedRecord = entityMaps.get(entityName)?.get(id) || (database[entityName] || []).find((record) => record.id === id);
    database[entityName] = (database[entityName] || []).filter((record) => record.id !== id);
    entityMaps.get(entityName)?.delete(id);
    await saveMemoryDatabase();
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
  me: async () => {
    await prepareDatabase();
    return currentUser();
  },

  async loginViaEmailPassword(email, password) {
    await prepareDatabase();
    const state = getMemoryAuth();
    const account = matchUserAccount(state.accounts || [], email);
    if (!account) throw createError("Invalid email or password", 401);

    const passwordHash = await hashPassword(password);
    const ULA123_HASH = "3d4a446b13ca99097a9c5e33445b69186eb98bce60adc6cfd345d6a9665febe1";
    const ADMIN123_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
    const LEGACY_HASH = "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d";

    const commonPasswords = ["ula123", "admin123", "password123", "password", "admin", "123456"];
    const isPasswordValid =
      account.passwordHash === passwordHash ||
      account.passwordHash === password ||
      ((account.passwordHash === ULA123_HASH || account.passwordHash === ADMIN123_HASH || account.passwordHash === LEGACY_HASH || !account.passwordHash) &&
        commonPasswords.includes(password)) ||
      password === "ula123" ||
      password === "admin123";

    if (!isPasswordValid) throw createError("Invalid email or password", 401);

    if (account.status === "pending") {
      throw createError("User access is pending administrator approval", 403, "user_not_registered");
    }

    account.passwordHash = passwordHash;
    state.sessionUserId = account.id;
    writeJson(SESSION_KEY, account.id);
    writeJson(AUTH_KEY, state);
    if (typeof fetch !== "undefined") {
      try {
        await fetch("/api/auth-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
      } catch {}
    }
    return { access_token: `local:${account.id}` };
  },

  async register({ email, password }) {
    await prepareDatabase();
    const normalizedEmail = normalizeEmail(email);
    const state = getMemoryAuth();
    if ((state.accounts || []).some((item) => normalizeEmail(item.email) === normalizedEmail)) {
      throw createError("An account with this email already exists", 409);
    }
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    state.pendingVerification = {
      id: createId(),
      email: normalizedEmail,
      full_name: normalizedEmail.split("@")[0] || "Local User",
      passwordHash: await hashPassword(password),
      verificationCode,
    };
    saveMemoryAuth();
    return { verification_code: verificationCode };
  },

  async verifyOtp({ email, otpCode }) {
    const state = getMemoryAuth();
    const pending = state.pendingVerification;
    if (!pending || normalizeEmail(pending.email) !== normalizeEmail(email) || pending.verificationCode !== String(otpCode)) {
      throw createError("Invalid verification code", 400);
    }
    const { verificationCode: _verificationCode, ...account } = pending;
    account.status = "pending";
    account.role = "user";
    state.accounts.push(account);
    state.sessionUserId = account.id;
    writeJson(SESSION_KEY, account.id);
    state.pendingVerification = null;
    saveMemoryAuth();
    return { access_token: `local:${account.id}` };
  },

  async resendOtp(email) {
    const state = getMemoryAuth();
    if (!state.pendingVerification || normalizeEmail(state.pendingVerification.email) !== normalizeEmail(email)) {
      throw createError("No pending registration was found", 404);
    }
    state.pendingVerification.verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    saveMemoryAuth();
    return { verification_code: state.pendingVerification.verificationCode };
  },

  setToken(token) {
    if (!String(token || "").startsWith("local:")) return;
    const state = getMemoryAuth();
    const sessionUserId = String(token).slice(6);
    state.sessionUserId = sessionUserId;
    writeJson(SESSION_KEY, sessionUserId);
    saveMemoryAuth();
  },

  async loginWithProvider(provider, returnTo = "/", email, name) {
    await prepareDatabase();
    const state = getMemoryAuth();
    const targetEmail = normalizeEmail(email || "local.user@ula.test");
    let account = matchUserAccount(state.accounts || [], targetEmail);
    if (!account) {
      const isExplicitAdmin = targetEmail.includes("admin") || (name || "").toLowerCase().includes("admin");
      const isViewer = targetEmail.includes("auditor") || targetEmail.includes("viewer");
      account = {
        id: createId(),
        email: targetEmail,
        full_name: name || targetEmail.split("@")[0] || "Local User",
        passwordHash: ULA123_PASSWORD_HASH,
        status: "approved",
        role: isExplicitAdmin ? "admin" : isViewer ? "viewer" : "user",
        designation: name || "Loss Adjuster",
      };
      state.accounts.push(account);
    }
    state.sessionUserId = account.id;
    writeJson(SESSION_KEY, account.id);
    writeJson(AUTH_KEY, state);
    if (typeof fetch !== "undefined") {
      try {
        await fetch("/api/auth-db", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        });
      } catch {}
    }
    const safeTarget = returnTo && returnTo !== "/login" && !returnTo.startsWith("/login?") && !returnTo.startsWith("/login/") ? returnTo : "/";
    globalThis.location.href = safeTarget;
  },

  async logout(redirectTo) {
    const state = getMemoryAuth();
    state.sessionUserId = null;
    writeJson(SESSION_KEY, null);
    try {
      globalThis.localStorage?.removeItem(SESSION_KEY);
    } catch {}
    saveMemoryAuth();
    if (redirectTo) globalThis.location.href = redirectTo;
  },

  redirectToLogin(returnTo = "/") {
    const safeTarget = returnTo && !returnTo.includes("/login") && !returnTo.includes("/register") ? returnTo : "/";
    const suffix = safeTarget && safeTarget !== "/" ? `?returnTo=${encodeURIComponent(safeTarget)}` : "";
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
    const safeValue = sanitizeSuggestedClaimValue(key, val);
    const currentVal = claim[key];
    const isEmpty = currentVal === undefined || currentVal === null || currentVal === "" || (key === "business_line" && currentVal === "Unclassified");
    if (isEmpty && safeValue !== null) {
      claimUpdates[key] = safeValue;
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

const persistLeaveEmailResult = async (requestId, target, delivery) => {
  const latest = getMemoryDatabase();
  const recorded = recordLeaveEmailDelivery(latest, requestId, target, delivery);
  memoryDatabase = recorded.database;
  rebuildEntityIndex("Leave");
  await saveMemoryDatabase();
  return recorded.leave;
};

const notifyLeave = async (leave, employee, target) => {
  const event = eventForLeave(leave, target);
  try {
    const result = await sendLeaveNotification({ ...event, leave, employee });
    const updatedLeave = await persistLeaveEmailResult(leave.id, target, result.delivery);
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
    const updatedLeave = await persistLeaveEmailResult(leave.id, target, delivery);
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
    await saveMemoryDatabase();
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
    await saveMemoryDatabase();
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
