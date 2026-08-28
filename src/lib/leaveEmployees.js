export const ULA_LEAVE_EMPLOYEES = Object.freeze([
  {
    id: "employee-petro-zaarour",
    accountId: "account-petro-zaarour",
    name: "Petro Zaarour",
    email: "petro.zaarour@unitedlossadjusters.com",
    role: "Director",
  },
  {
    id: "employee-annie-abdel-massih",
    accountId: "account-annie-abdel-massih",
    name: "Annie Abdel Massih",
    email: "annie.abdelmassih@unitedlossadjusters.com",
    role: "Claims Director",
  },
  {
    id: "employee-estefani-haddad",
    accountId: "account-estefani-haddad",
    name: "Estefani Haddad",
    email: "estefani.haddad@unitedlossadjusters.com",
    role: "Claims Handler",
  },
  {
    id: "employee-hovig-kalandjian",
    accountId: "account-hovig-kalandjian",
    name: "Hovig Kalandjian",
    email: "hovig.kalandjian@unitedlossadjusters.com",
    role: "Marine and Cargo Senior Surveyor",
  },
  {
    id: "employee-feyez-dghayli",
    accountId: "account-feyez-dghayli",
    name: "Feyez Dghayli",
    email: "feyez.dghayli@unitedlossadjusters.com",
    role: "Technical Specialist",
  },
  {
    id: "employee-rana-rizk",
    accountId: "account-rana-rizk",
    name: "Rana Rizk",
    email: "rana.rizk@unitedlossadjusters.com",
    role: "Claims Handler",
  },
  {
    id: "employee-fares-fares",
    accountId: "account-fares-fares",
    name: "Fares Fares",
    email: "fares.fares@unitedlossadjusters.com",
    role: "Surveyor",
  },
]);

export const ULA_LEAVE_APPROVER_EMAILS = Object.freeze([
  "annie.abdelmassih@unitedlossadjusters.com",
  "petro.zaarour@unitedlossadjusters.com",
]);

export const normalizeLeaveEmail = (value) => String(value || "").trim().toLowerCase();

export const isLeaveApprover = (user) => ULA_LEAVE_APPROVER_EMAILS.includes(normalizeLeaveEmail(user?.email));

export function seededLeaveEmployees(year = new Date().getFullYear()) {
  return ULA_LEAVE_EMPLOYEES.map((employee) => ({
    id: employee.id,
    account_id: employee.accountId,
    name: employee.name,
    email: employee.email,
    role: employee.role,
    department: employee.role,
    annual_leave_entitlement_days: 15,
    annual_leave_total: 15,
    annual_leave_used: 0,
    annual_leave_year: year,
    toil_balance: 0,
  }));
}
