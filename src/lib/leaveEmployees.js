export const ULA_LEAVE_EMPLOYEES = Object.freeze([
  { id: "employee-petro-zaarour", name: "Petro Zaarour", email: "petro.zaarour@unitedlossadjusters.com", role: "Director" },
  { id: "employee-annie-abdel-massih", name: "Annie Abdel Massih", email: "annie.abdelmassih@unitedlossadjusters.com", role: "Claims Director" },
  { id: "employee-estefani-haddad", name: "Estefani Haddad", email: "estefani.haddad@unitedlossadjusters.com", role: "Claims Handler" },
  { id: "employee-hovig-kalandjian", name: "Hovig Kalandjian", email: "hovig.kalandjian@unitedlossadjusters.com", role: "Marine and Cargo Senior Surveyor" },
  { id: "employee-feyez-dghayli", name: "Feyez Dghayli", email: "feyez.dghayli@unitedlossadjusters.com", role: "Technical Specialist" },
  { id: "employee-rana-rizk", name: "Rana Rizk", email: "Rana.Rizk@unitedlossadjusters.com", role: "Claims Handler" },
  { id: "employee-fares-fares", name: "Fares Fares", email: "Fares.Fares@unitedlossadjusters.com", role: "Surveyor" },
]);

export const ULA_LEAVE_APPROVER_EMAILS = Object.freeze([
  "annie.abdelmassih@unitedlossadjusters.com",
  "petro.zaarour@unitedlossadjusters.com",
]);

export const normalizeLeaveEmail = (value) => String(value || "").trim().toLowerCase();

export const isLeaveApprover = (user) => ULA_LEAVE_APPROVER_EMAILS.includes(normalizeLeaveEmail(user?.email));

export function seededLeaveEmployees(year = new Date().getFullYear()) {
  return ULA_LEAVE_EMPLOYEES.map((employee) => ({
    ...employee,
    department: employee.role,
    annual_leave_entitlement_days: 15,
    annual_leave_total: 15,
    annual_leave_used: 0,
    annual_leave_year: year,
    toil_balance: 0,
  }));
}
