import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(ROOT_DIR, ".data");
const UPLOADS_DIR = path.resolve(DATA_DIR, "uploads");
const CLAIMS_DB_FILE = path.resolve(DATA_DIR, "claims_db.json");
const AUTH_DB_FILE = path.resolve(DATA_DIR, "auth_db.json");

export const ENTITY_NAMES = [
  "Claim",
  "ClaimDocument",
  "Employee",
  "Leave",
  "ReportVersion",
  "User",
];

const DEFAULT_AUTH = {
  accounts: [
    {
      id: "admin-id",
      email: "admin@ula.com",
      full_name: "ULA Administrator",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d", // ula123 / admin123
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
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-annie-abdelmassih",
      email: "annie.abdelmassih@unitedlossadjusters.com",
      full_name: "Annie Abdel Massih",
      designation: "Claims Director",
      role: "admin",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-estefani-haddad",
      email: "estefani.haddad@unitedlossadjusters.com",
      full_name: "Estefani Haddad",
      designation: "Claims Handler",
      role: "user",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-hovig-kalandjian",
      email: "hovig.kalandjian@unitedlossadjusters.com",
      full_name: "Hovig Kalandjian",
      designation: "Marine and Cargo Senior Surveyor",
      role: "user",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-feyez-dghayli",
      email: "feyez.dghayli@unitedlossadjusters.com",
      full_name: "Feyez Dghayli",
      designation: "Technical Specialist",
      role: "user",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-rana-rizk",
      email: "Rana.Rizk@unitedlossadjusters.com",
      full_name: "Rana Rizk",
      designation: "Claims Handler",
      role: "user",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
    {
      id: "user-fares-fares",
      email: "Fares.Fares@unitedlossadjusters.com",
      full_name: "Fares Fares",
      designation: "Surveyor",
      role: "user",
      status: "approved",
      passwordHash: "240eb518e1d234d74a7ca33d1c47db5515438c3505d9e504c5409ec8b7c6ee5d",
    },
  ],
  sessionUserId: null,
  pendingVerification: null,
  resetRequests: {},
};

export function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function atomicWriteJson(filePath, data) {
  ensureDirectories();
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath, fallback = {}) {
  ensureDirectories();
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`[DiskDB] Error reading ${filePath}:`, err.message);
  }
  return fallback;
}

class DiskDatabase {
  constructor() {
    ensureDirectories();
    this.claimsDb = null;
    this.authDb = null;
  }

  getClaimsDb() {
    if (!this.claimsDb) {
      const initial = safeReadJson(CLAIMS_DB_FILE, null);
      if (!initial || typeof initial !== "object") {
        const empty = {};
        for (const name of ENTITY_NAMES) {
          empty[name] = [];
        }
        this.claimsDb = empty;
        this.saveClaimsDb();
      } else {
        for (const name of ENTITY_NAMES) {
          if (!Array.isArray(initial[name])) {
            initial[name] = [];
          }
        }
        this.claimsDb = initial;
      }
    }
    return this.claimsDb;
  }

  saveClaimsDb() {
    if (this.claimsDb) {
      atomicWriteJson(CLAIMS_DB_FILE, this.claimsDb);
    }
  }

  getAuthDb() {
    if (!this.authDb) {
      const initial = safeReadJson(AUTH_DB_FILE, null);
      if (!initial || typeof initial !== "object" || !Array.isArray(initial.accounts)) {
        this.authDb = JSON.parse(JSON.stringify(DEFAULT_AUTH));
        this.saveAuthDb();
      } else {
        this.authDb = initial;
      }
    }
    return this.authDb;
  }

  saveAuthDb() {
    if (this.authDb) {
      atomicWriteJson(AUTH_DB_FILE, this.authDb);
    }
  }

  list(entity, query = {}) {
    const db = this.getClaimsDb();
    const items = db[entity] || [];
    let results = items;

    if (query && typeof query === "object") {
      results = results.filter((item) => {
        for (const [key, value] of Object.entries(query)) {
          if (item[key] !== value) return false;
        }
        return true;
      });
    }

    return JSON.parse(JSON.stringify(results));
  }

  get(entity, id) {
    const db = this.getClaimsDb();
    const items = db[entity] || [];
    const found = items.find((item) => item.id === id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  create(entity, data) {
    const db = this.getClaimsDb();
    if (!Array.isArray(db[entity])) {
      db[entity] = [];
    }

    const item = {
      ...data,
      id: data.id || crypto.randomUUID(),
      created_at: data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    db[entity].push(item);
    this.saveClaimsDb();
    return JSON.parse(JSON.stringify(item));
  }

  update(entity, id, updates) {
    const db = this.getClaimsDb();
    const items = db[entity] || [];
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      throw new Error(`Entity ${entity} with id ${id} not found`);
    }

    const updated = {
      ...items[index],
      ...updates,
      id, // Preserve ID
      updated_at: new Date().toISOString(),
    };

    items[index] = updated;
    this.saveClaimsDb();
    return JSON.parse(JSON.stringify(updated));
  }

  delete(entity, id) {
    const db = this.getClaimsDb();
    const items = db[entity] || [];
    const index = items.findIndex((item) => item.id === id);

    if (index === -1) {
      return false;
    }

    const [deleted] = items.splice(index, 1);
    this.saveClaimsDb();
    return JSON.parse(JSON.stringify(deleted));
  }

  setFullClaimsDb(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid database payload");
    }
    const validated = {};
    for (const name of ENTITY_NAMES) {
      validated[name] = Array.isArray(data[name]) ? data[name] : [];
    }
    this.claimsDb = validated;
    this.saveClaimsDb();
    return this.claimsDb;
  }

  setFullAuthDb(data) {
    if (!data || typeof data !== "object" || !Array.isArray(data.accounts)) {
      throw new Error("Invalid auth database payload");
    }
    this.authDb = data;
    this.saveAuthDb();
    return this.authDb;
  }
}

export const diskDb = new DiskDatabase();
export { DATA_DIR, UPLOADS_DIR, CLAIMS_DB_FILE, AUTH_DB_FILE };
