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

export function seedUsers({ verbose = true } = {}) {
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

  for (const member of SEEDED_TEAM_MEMBERS) {
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

  for (const member of SEEDED_TEAM_MEMBERS) {
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
    console.log(" [ULA SEEDER] United Loss Adjusters Team Members ");
    console.log("==================================================");
    console.log(`✓ Auth accounts: ${addedAuthCount} added, ${updatedAuthCount} updated`);
    console.log(`✓ Employees registered: ${claimsDb.Employee.length} total active team members (${addedEmployeeCount} newly added)`);
    console.log("--------------------------------------------------");
    SEEDED_TEAM_MEMBERS.forEach((m) => {
      console.log(` • ${m.full_name.padEnd(22)} | ${m.designation.padEnd(35)} | ${m.email} [${m.role.toUpperCase()}]`);
    });
    console.log("--------------------------------------------------");
    console.log("Default password for all seeded accounts: ula123");
    console.log("==================================================\n");
  }

  return {
    success: true,
    seeded: SEEDED_TEAM_MEMBERS.length,
    addedAuth: addedAuthCount,
    updatedAuth: updatedAuthCount,
    addedEmployees: addedEmployeeCount,
  };
}

// Run immediately if executed from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedUsers();
}
