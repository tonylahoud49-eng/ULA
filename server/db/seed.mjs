import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(ROOT_DIR, ".data");
const CLAIMS_DB_FILE = path.resolve(DATA_DIR, "claims_db.json");
const AUTH_DB_FILE = path.resolve(DATA_DIR, "auth_db.json");

// SHA-256 hash for default password: "ula123"
const DEFAULT_PASSWORD_HASH = crypto.createHash("sha256").update("ula123").digest("hex");

export const SEEDED_TEAM_MEMBERS = [
  {
    id: "user-petro-zaarour",
    email: "petro.zaarour@unitedlossadjusters.com",
    full_name: "Petro Zaarour",
    designation: "Director",
    role: "admin",
    status: "approved",
    department: "Executive Management",
    annual_leave_total: 20,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-annie-abdelmassih",
    email: "annie.abdelmassih@unitedlossadjusters.com",
    full_name: "Annie Abdel Massih",
    designation: "Claims Director",
    role: "admin",
    status: "approved",
    department: "Claims Review & Technical Approval",
    annual_leave_total: 18,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-estefani-haddad",
    email: "estefani.haddad@unitedlossadjusters.com",
    full_name: "Estefani Haddad",
    designation: "Claims Handler",
    role: "user",
    status: "approved",
    department: "Claims Administration",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-hovig-kalandjian",
    email: "hovig.kalandjian@unitedlossadjusters.com",
    full_name: "Hovig Kalandjian",
    designation: "Marine and Cargo Senior Surveyor",
    role: "user",
    status: "approved",
    department: "Marine & Cargo Surveying",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-feyez-dghayli",
    email: "feyez.dghayli@unitedlossadjusters.com",
    full_name: "Feyez Dghayli",
    designation: "Technical Specialist",
    role: "user",
    status: "approved",
    department: "Technical Engineering",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-rana-rizk",
    email: "Rana.Rizk@unitedlossadjusters.com",
    full_name: "Rana Rizk",
    designation: "Claims Handler",
    role: "user",
    status: "approved",
    department: "Claims Administration",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "user-fares-fares",
    email: "Fares.Fares@unitedlossadjusters.com",
    full_name: "Fares Fares",
    designation: "Surveyor",
    role: "user",
    status: "approved",
    department: "Survey Operations",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
];

export const SEEDED_DEMO_USERS = [
  {
    id: "demo-admin",
    email: "admin.demo@unitedlossadjusters.com",
    full_name: "Generic Admin",
    designation: "Claims Director & Approver",
    role: "admin",
    status: "approved",
    department: "Executive Management",
    annual_leave_total: 20,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "demo-senior-surveyor",
    email: "surveyor.senior@unitedlossadjusters.com",
    full_name: "Generic Senior Surveyor",
    designation: "Senior Marine & Cargo Surveyor",
    role: "user",
    status: "approved",
    department: "Marine & Cargo Surveying",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "demo-claims-handler",
    email: "handler.demo@unitedlossadjusters.com",
    full_name: "Generic Claims Handler",
    designation: "Claims Handler & Adjuster",
    role: "user",
    status: "approved",
    department: "Claims Administration",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "demo-surveyor",
    email: "surveyor.demo@unitedlossadjusters.com",
    full_name: "Generic Marine Surveyor",
    designation: "Marine Surveyor",
    role: "user",
    status: "approved",
    department: "Survey Operations",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "demo-specialist",
    email: "specialist.demo@unitedlossadjusters.com",
    full_name: "Generic Technical Specialist",
    designation: "Engineering & Technical Specialist",
    role: "user",
    status: "approved",
    department: "Technical Engineering",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
  {
    id: "demo-auditor",
    email: "auditor.demo@unitedlossadjusters.com",
    full_name: "Generic Compliance Auditor",
    designation: "Read-Only Compliance Auditor",
    role: "viewer",
    status: "approved",
    department: "Quality Assurance",
    annual_leave_total: 15,
    annual_leave_used: 0,
    toil_balance: 0,
  },
];

export const ALL_SEEDED_ACCOUNTS = [...SEEDED_TEAM_MEMBERS, ...SEEDED_DEMO_USERS];

export function seedUsers({ verbose = true } = {}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local JSON seeder is disabled in production. Provision PostgreSQL users through the secured admin workflow.");
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // 1. Seed Auth DB
  let authDb = {
    accounts: [],
    sessionUserId: null,
    pendingVerification: null,
    resetRequests: {},
  };

  if (fs.existsSync(AUTH_DB_FILE)) {
    try {
      authDb = JSON.parse(fs.readFileSync(AUTH_DB_FILE, "utf-8"));
      if (!Array.isArray(authDb.accounts)) authDb.accounts = [];
    } catch {
      authDb.accounts = [];
    }
  }

  let addedAuthCount = 0;
  let updatedAuthCount = 0;

  for (const member of ALL_SEEDED_ACCOUNTS) {
    const existingIndex = authDb.accounts.findIndex(
      (acc) => acc.email.toLowerCase() === member.email.toLowerCase() || acc.id === member.id
    );

    const accountRecord = {
      id: member.id,
      email: member.email,
      full_name: member.full_name,
      designation: member.designation,
      role: member.role,
      status: member.status,
      passwordHash: DEFAULT_PASSWORD_HASH,
      department: member.department,
      created_at: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      authDb.accounts[existingIndex] = {
        ...authDb.accounts[existingIndex],
        ...accountRecord,
        passwordHash: authDb.accounts[existingIndex].passwordHash || DEFAULT_PASSWORD_HASH,
      };
      updatedAuthCount++;
    } else {
      authDb.accounts.push(accountRecord);
      addedAuthCount++;
    }
  }

  fs.writeFileSync(AUTH_DB_FILE, JSON.stringify(authDb, null, 2), "utf-8");

  // 2. Seed Claims DB (Employees & Users)
  let claimsDb = {
    Claim: [],
    ClaimDocument: [],
    Employee: [],
    Leave: [],
    ReportVersion: [],
    User: [],
  };

  if (fs.existsSync(CLAIMS_DB_FILE)) {
    try {
      claimsDb = JSON.parse(fs.readFileSync(CLAIMS_DB_FILE, "utf-8"));
    } catch {
      // Keep empty structure
    }
  }

  for (const entity of ["Claim", "ClaimDocument", "Employee", "Leave", "ReportVersion", "User"]) {
    if (!Array.isArray(claimsDb[entity])) claimsDb[entity] = [];
  }

  let addedEmployeeCount = 0;

  for (const member of ALL_SEEDED_ACCOUNTS) {
    // User record
    const userIndex = claimsDb.User.findIndex(
      (u) => u.email?.toLowerCase() === member.email.toLowerCase() || u.id === member.id
    );
    const userRecord = {
      id: member.id,
      email: member.email,
      full_name: member.full_name,
      designation: member.designation,
      role: member.role,
      status: member.status,
      department: member.department,
      created_date: new Date().toISOString(),
    };

    if (userIndex >= 0) {
      claimsDb.User[userIndex] = { ...claimsDb.User[userIndex], ...userRecord };
    } else {
      claimsDb.User.push(userRecord);
    }

    // Employee record (for HR / Leave / Assignment workflow)
    const empIndex = claimsDb.Employee.findIndex(
      (e) => e.email?.toLowerCase() === member.email.toLowerCase() || e.id === member.id || e.user_id === member.id
    );

    const empRecord = {
      id: member.id,
      user_id: member.id,
      name: member.full_name,
      email: member.email,
      designation: member.designation,
      department: member.department,
      annual_leave_total: member.annual_leave_total,
      annual_leave_used: member.annual_leave_used,
      toil_balance: member.toil_balance,
      status: "Active",
      created_date: new Date().toISOString(),
    };

    if (empIndex >= 0) {
      claimsDb.Employee[empIndex] = { ...claimsDb.Employee[empIndex], ...empRecord };
    } else {
      claimsDb.Employee.push(empRecord);
      addedEmployeeCount++;
    }
  }

  fs.writeFileSync(CLAIMS_DB_FILE, JSON.stringify(claimsDb, null, 2), "utf-8");

  if (verbose) {
    console.log("==================================================");
    console.log(" [ULA SEEDER] United Loss Adjusters Team & Roles  ");
    console.log("==================================================");
    console.log(`✓ Auth accounts: ${addedAuthCount} added, ${updatedAuthCount} updated`);
    console.log(`✓ Total accounts & employees registered: ${claimsDb.Employee.length}`);
    console.log("--------------------------------------------------");
    console.log("Official ULA Team Members:");
    SEEDED_TEAM_MEMBERS.forEach((m) => {
      console.log(` • ${m.full_name.padEnd(22)} | ${m.designation.padEnd(35)} | ${m.email} [${m.role.toUpperCase()}]`);
    });
    console.log("--------------------------------------------------");
    console.log("Generic Test / Demo Personas:");
    SEEDED_DEMO_USERS.forEach((m) => {
      console.log(` • ${m.full_name.padEnd(22)} | ${m.designation.padEnd(35)} | ${m.email} [${m.role.toUpperCase()}]`);
    });
    console.log("--------------------------------------------------");
    console.log("Default password for all accounts: ula123");
    console.log("==================================================\n");
  }

  return {
    success: true,
    seeded: ALL_SEEDED_ACCOUNTS.length,
    addedAuth: addedAuthCount,
    updatedAuth: updatedAuthCount,
    addedEmployees: addedEmployeeCount,
  };
}

// Run immediately if executed from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedUsers();
}
