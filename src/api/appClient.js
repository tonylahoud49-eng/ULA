import { documentStorage } from "@/api/documentStorage";

const DATABASE_KEY = "ula_claims_hub_database_v1";
const AUTH_KEY = "ula_claims_hub_auth_v1";

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
  accounts: [],
  sessionUserId: null,
  pendingVerification: null,
  resetRequests: {},
});

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

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
  const database = readJson(DATABASE_KEY, emptyDatabase);
  const documents = database.ClaimDocument || [];
  let changed = false;

  const migratedDocuments = [];
  for (const document of documents) {
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
    writeJson(DATABASE_KEY, database);
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

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const hashPassword = async (password) => {
  const value = String(password || "");
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return value;
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const currentUser = () => {
  const auth = readJson(AUTH_KEY, emptyAuth);
  const account = auth.accounts.find((item) => item.id === auth.sessionUserId);
  if (!account) throw createError("Authentication required", 401);
  const { passwordHash: _passwordHash, ...user } = account;
  return clone(user);
};

const createEntityApi = (entityName) => ({
  async list(sort, limit) {
    await prepareDatabase();
    const database = readJson(DATABASE_KEY, emptyDatabase);
    let records = [...(database[entityName] || [])];

    if (sort) {
      const descending = sort.startsWith("-");
      const field = descending ? sort.slice(1) : sort;
      records.sort((left, right) => {
        const a = left[field] ?? "";
        const b = right[field] ?? "";
        return (a > b ? 1 : a < b ? -1 : 0) * (descending ? -1 : 1);
      });
    }

    if (Number.isFinite(limit)) records = records.slice(0, limit);
    return clone(records);
  },

  async get(id) {
    await prepareDatabase();
    const database = readJson(DATABASE_KEY, emptyDatabase);
    return clone((database[entityName] || []).find((record) => record.id === id) || null);
  },

  async filter(criteria = {}) {
    await prepareDatabase();
    const database = readJson(DATABASE_KEY, emptyDatabase);
    return clone((database[entityName] || []).filter((record) =>
      Object.entries(criteria).every(([key, value]) => record[key] === value),
    ));
  },

  async create(values) {
    await prepareDatabase();
    if (entityName === "ClaimDocument") assertDocumentMetadataOnly(values);
    const database = readJson(DATABASE_KEY, emptyDatabase);
    const timestamp = new Date().toISOString();
    const record = {
      ...clone(entityDefaults[entityName]),
      ...clone(values),
      id: createId(),
      created_date: timestamp,
      updated_date: timestamp,
    };
    database[entityName] = [...(database[entityName] || []), record];
    writeJson(DATABASE_KEY, database);
    return clone(record);
  },

  async update(id, values) {
    await prepareDatabase();
    if (entityName === "ClaimDocument") assertDocumentMetadataOnly(values);
    const database = readJson(DATABASE_KEY, emptyDatabase);
    const records = database[entityName] || [];
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) throw createError(`${entityName} record not found`, 404);
    records[index] = {
      ...records[index],
      ...clone(values),
      id: records[index].id,
      updated_date: new Date().toISOString(),
    };
    database[entityName] = records;
    writeJson(DATABASE_KEY, database);
    return clone(records[index]);
  },

  async delete(id) {
    await prepareDatabase();
    const database = readJson(DATABASE_KEY, emptyDatabase);
    const deletedRecord = (database[entityName] || []).find((record) => record.id === id);
    database[entityName] = (database[entityName] || []).filter((record) => record.id !== id);
    writeJson(DATABASE_KEY, database);
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
  me: async () => currentUser(),

  async loginViaEmailPassword(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const passwordHash = await hashPassword(password);
    const state = readJson(AUTH_KEY, emptyAuth);
    const account = state.accounts.find((item) => item.email === normalizedEmail && item.passwordHash === passwordHash);
    if (!account) throw createError("Invalid email or password", 401);
    state.sessionUserId = account.id;
    writeJson(AUTH_KEY, state);
    return { access_token: `local:${account.id}` };
  },

  async register({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const state = readJson(AUTH_KEY, emptyAuth);
    if (state.accounts.some((item) => item.email === normalizedEmail)) {
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
    writeJson(AUTH_KEY, state);
    return { verification_code: verificationCode };
  },

  async verifyOtp({ email, otpCode }) {
    const state = readJson(AUTH_KEY, emptyAuth);
    const pending = state.pendingVerification;
    if (!pending || pending.email !== normalizeEmail(email) || pending.verificationCode !== String(otpCode)) {
      throw createError("Invalid verification code", 400);
    }
    const { verificationCode: _verificationCode, ...account } = pending;
    state.accounts.push(account);
    state.sessionUserId = account.id;
    state.pendingVerification = null;
    writeJson(AUTH_KEY, state);
    return { access_token: `local:${account.id}` };
  },

  async resendOtp(email) {
    const state = readJson(AUTH_KEY, emptyAuth);
    if (!state.pendingVerification || state.pendingVerification.email !== normalizeEmail(email)) {
      throw createError("No pending registration was found", 404);
    }
    state.pendingVerification.verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    writeJson(AUTH_KEY, state);
    return { verification_code: state.pendingVerification.verificationCode };
  },

  setToken(token) {
    if (!String(token || "").startsWith("local:")) return;
    const state = readJson(AUTH_KEY, emptyAuth);
    state.sessionUserId = String(token).slice(6);
    writeJson(AUTH_KEY, state);
  },

  async loginWithProvider(_provider, returnTo = "/") {
    const state = readJson(AUTH_KEY, emptyAuth);
    let account = state.accounts.find((item) => item.email === "local.user@ula.test");
    if (!account) {
      account = {
        id: createId(),
        email: "local.user@ula.test",
        full_name: "Local User",
        passwordHash: "",
      };
      state.accounts.push(account);
    }
    state.sessionUserId = account.id;
    writeJson(AUTH_KEY, state);
    globalThis.location.href = returnTo || "/";
  },

  async logout(redirectTo) {
    const state = readJson(AUTH_KEY, emptyAuth);
    state.sessionUserId = null;
    writeJson(AUTH_KEY, state);
    if (redirectTo) globalThis.location.href = redirectTo;
  },

  redirectToLogin(returnTo = "/") {
    const suffix = returnTo && returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    globalThis.location.href = `/login${suffix}`;
  },

  async resetPasswordRequest(email) {
    const state = readJson(AUTH_KEY, emptyAuth);
    const account = state.accounts.find((item) => item.email === normalizeEmail(email));
    if (!account) return {};
    const resetToken = createId();
    state.resetRequests[resetToken] = account.id;
    writeJson(AUTH_KEY, state);
    return { reset_token: resetToken };
  },

  async resetPassword({ resetToken, newPassword }) {
    const state = readJson(AUTH_KEY, emptyAuth);
    const accountId = state.resetRequests[resetToken];
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) throw createError("This password reset link is invalid or expired", 400);
    account.passwordHash = await hashPassword(newPassword);
    delete state.resetRequests[resetToken];
    writeJson(AUTH_KEY, state);
  },
};

const buildAnalysis = async ({ claim_id: claimId }) => {
  const claim = await entities.Claim.get(claimId);
  if (!claim) throw createError("Claim not found", 404);
  const documents = await entities.ClaimDocument.filter({ claim_id: claimId });
  if (!documents.length) throw createError("No documents uploaded for this claim");

  const requiredFields = ["insured", "insurer", "policy_number", "date_of_loss", "cause_of_loss"];
  const missingDocuments = requiredFields
    .filter((field) => !claim[field])
    .map((field) => field.replaceAll("_", " "));
  const classified = claim.business_line && claim.business_line !== "Unclassified";
  const analysis = {
    ...clone(claim),
    business_line: claim.business_line || "Unclassified",
    confidence: classified ? 75 : 25,
    missing_documents: missingDocuments,
    evidence_sources: documents.map((document) => ({
      field: "Uploaded evidence",
      source: document.file_name,
      confidence: "Low",
    })),
    summary: `Local review prepared from ${documents.length} uploaded document(s). Automated extraction requires an external AI service.`,
  };

  await entities.Claim.update(claimId, {
    ai_confidence: analysis.confidence,
    ai_classification_source: "Local document review",
    missing_documents: missingDocuments,
  });
  return { data: { analysis, claim_id: claimId, document_count: documents.length } };
};

const buildReport = async ({ claim_id: claimId, edited_data: editedData }) => {
  const storedClaim = await entities.Claim.get(claimId);
  if (!storedClaim) throw createError("Claim not found", 404);
  const claim = editedData ? { ...storedClaim, ...clone(editedData) } : storedClaim;
  const documents = await entities.ClaimDocument.filter({ claim_id: claimId });
  const versions = await entities.ReportVersion.filter({ claim_id: claimId });
  const value = (item, fallback = "Requires confirmation — document not provided") => item || fallback;
  const content = `# ${value(claim.claim_number, "Claim Report")}

## Cover Page

- **Claim:** ${value(claim.title)}
- **Business Line:** ${value(claim.business_line, "Unclassified")}
- **Insured:** ${value(claim.insured)}
- **Insurer:** ${value(claim.insurer)}
- **Surveyor:** ${value(claim.surveyor, "To be assigned")}
- **Date:** ${new Date().toLocaleDateString()}

## Report Summary

This locally generated draft is based on the information entered in the claim record and the uploaded evidence list. Professional review and confirmation are required before finalization.

## Claim Summary Table

| Field | Value |
| --- | --- |
| Policy Number | ${value(claim.policy_number)} |
| Date of Loss | ${value(claim.date_of_loss)} |
| Cause of Loss | ${value(claim.cause_of_loss)} |
| Claim Amount | ${value(claim.claim_amount, "To be quantified")} |

## Findings

${value(claim.description)}

## Cause of Loss

${value(claim.cause_of_loss)}

## Policy Analysis

Policy terms, limits, exclusions, and deductible require professional review against the complete policy documentation.

## Adjustment

The adjustment remains subject to verification of supporting evidence and claimed values.

## Liability Discussion

Liability has not been independently determined in this local draft.

## Recommendations

Review all supporting documents, confirm outstanding information, and obtain insurer instructions before finalizing the report.

## Conclusion

This document is a draft for review and is not a final coverage or liability determination.

## Appendices

${documents.length ? documents.map((document) => `- ${document.file_name} (${document.file_type || "Other"})`).join("\n") : "- No supporting documents uploaded"}

## Supporting Documents

See the appendices above.

## Outstanding Documents

${claim.missing_documents?.length ? claim.missing_documents.map((item) => `- ${item}`).join("\n") : "- None identified"}

## Photo References

${documents.filter((document) => document.file_type === "Photo").map((document) => `- ${document.file_name}`).join("\n") || "- No photo evidence uploaded"}`;

  const report = await entities.ReportVersion.create({
    claim_id: claimId,
    version_number: versions.length + 1,
    status: "Draft",
    content,
    generated_by: currentUser().full_name || currentUser().email,
    notes: "Locally generated draft",
  });
  await entities.Claim.update(claimId, { ...editedData, status: "Report Draft" });
  return { data: { report, claim_id: claimId } };
};

export const appClient = {
  auth,
  entities,
  documentStorage,
  integrations: {
    Core: {
      async UploadFile({ file }) {
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
        await documentStorage.delete(storageKey || fileUrl);
      },
    },
  },
  functions: {
    async invoke(name, payload) {
      if (name === "analyseClaim") return buildAnalysis(payload);
      if (name === "generateReport") return buildReport(payload);
      throw createError(`Unknown local function: ${name}`, 404);
    },
  },
  consent: {
    async getInfo(handle) {
      if (!handle) throw createError("This authorization link is invalid or expired", 400);
      let authenticated = true;
      try { currentUser(); } catch { authenticated = false; }
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
