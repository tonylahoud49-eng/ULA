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

export const ULA_2026_LEAVE_BASELINE = "2026-09-02";

const ULA_2026_EMPLOYEE_LEAVE = Object.freeze({
  "employee-annie-abdel-massih": {
    annual_leave_total: 15,
    annual_leave_used: 8,
    sick_leave_used: 1,
    leave_balance_baseline: "2026-09-02-annie-sick-1",
  },
  "employee-estefani-haddad": { annual_leave_total: 15, annual_leave_used: 0, sick_leave_used: 1 },
  "employee-hovig-kalandjian": { annual_leave_total: 15, annual_leave_used: 10.5, sick_leave_used: 3 },
  "employee-feyez-dghayli": { annual_leave_total: 16, annual_leave_used: 0 },
  "employee-rana-rizk": { annual_leave_total: 15, annual_leave_used: 5, sick_leave_used: 5 },
  "employee-fares-fares": { annual_leave_total: 15, annual_leave_used: 0, sick_leave_used: 0 },
});

export const normalizeLeaveEmail = (value) => String(value || "").trim().toLowerCase();

export const isLeaveApprover = (user) => ULA_LEAVE_APPROVER_EMAILS.includes(normalizeLeaveEmail(user?.email));

export function seededLeaveEmployees(year = new Date().getFullYear()) {
  return ULA_LEAVE_EMPLOYEES.map((employee) => {
    const baseline = year === 2026 ? ULA_2026_EMPLOYEE_LEAVE[employee.id] : null;
    const annualTotal = baseline?.annual_leave_total ?? 15;
    return {
      id: employee.id,
      account_id: employee.accountId,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department: employee.role,
      annual_leave_entitlement_days: annualTotal,
      annual_leave_total: annualTotal,
      annual_leave_used: baseline?.annual_leave_used ?? 0,
      annual_leave_year: year,
      sick_leave_used: baseline?.sick_leave_used ?? null,
      toil_balance: 0,
      leave_balance_baseline: baseline?.leave_balance_baseline ?? (baseline ? ULA_2026_LEAVE_BASELINE : null),
    };
  });
}
