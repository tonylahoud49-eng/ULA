import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(projectRoot, "docs", "ULA_IT_DEPLOYMENT_GUIDE.pdf");
const logoPath = path.join(projectRoot, "src", "assets", "ula-logo.png");

const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
pdf.setProperties({
  title: "ULA Claims Hub - IT Deployment Guide",
  subject: "Internal Windows VM deployment at https://ula.company.local",
  author: "United Loss Adjusters & Surveyors",
  creator: "ULA Claims Hub",
});

const pageWidth = pdf.internal.pageSize.getWidth();
const pageHeight = pdf.internal.pageSize.getHeight();
const margin = 16;
const contentWidth = pageWidth - margin * 2;
const teal = [31, 143, 126];
const dark = [25, 39, 47];
const slate = [83, 102, 112];
const pale = [239, 248, 246];
const line = [206, 219, 217];
const amber = [154, 93, 0];
const amberPale = [255, 247, 226];
const logoData = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
let pageNumber = 1;
let y = 0;

function addHeader(section) {
  pdf.addImage(logoData, "PNG", margin, 8, 22, 22);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...teal);
  pdf.text("ULA CLAIMS HUB", margin + 27, 17);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...slate);
  pdf.text(section.toUpperCase(), margin + 27, 22);
  pdf.setDrawColor(...line);
  pdf.line(margin, 32, pageWidth - margin, 32);
  y = 39;
}

function addFooter() {
  pdf.setDrawColor(...line);
  pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...slate);
  pdf.text("Internal IT guide | Version 1.0 | 02 September 2026", margin, pageHeight - 7);
  pdf.text(`Page ${pageNumber} of 3`, pageWidth - margin, pageHeight - 7, { align: "right" });
}

function newPage(section) {
  addFooter();
  pdf.addPage();
  pageNumber += 1;
  addHeader(section);
}

function heading(text, size = 15) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(size);
  pdf.setTextColor(...dark);
  pdf.text(text, margin, y);
  y += size * 0.45 + 3;
}

function paragraph(text, options = {}) {
  const x = options.x ?? margin;
  const width = options.width ?? contentWidth;
  pdf.setFont("helvetica", options.bold ? "bold" : "normal");
  pdf.setFontSize(options.size ?? 9.4);
  pdf.setTextColor(...(options.color ?? dark));
  const lines = pdf.splitTextToSize(text, width);
  pdf.text(lines, x, y, { lineHeightFactor: 1.3 });
  y += lines.length * (options.leading ?? 4.2) + (options.after ?? 2.5);
}

function bullets(items, options = {}) {
  const x = options.x ?? margin;
  const width = options.width ?? contentWidth;
  const size = options.size ?? 9;
  for (const item of items) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...dark);
    const lines = pdf.splitTextToSize(item, width - 6);
    pdf.setFillColor(...teal);
    pdf.circle(x + 1.4, y - 1.1, 0.65, "F");
    pdf.text(lines, x + 5, y, { lineHeightFactor: 1.25 });
    y += lines.length * 4 + 1.5;
  }
  y += options.after ?? 2;
}

function labelValue(label, value, x, width) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.6);
  pdf.setTextColor(...slate);
  pdf.text(label.toUpperCase(), x, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.2);
  pdf.setTextColor(...dark);
  const lines = pdf.splitTextToSize(value, width);
  pdf.text(lines, x, y + 5, { lineHeightFactor: 1.2 });
}

function codeBlock(lines) {
  const blockLines = Array.isArray(lines) ? lines : String(lines).split("\n");
  const height = blockLines.length * 4.4 + 7;
  pdf.setFillColor(247, 249, 249);
  pdf.setDrawColor(...line);
  pdf.roundedRect(margin, y, contentWidth, height, 2, 2, "FD");
  pdf.setFont("courier", "normal");
  pdf.setFontSize(8.4);
  pdf.setTextColor(...dark);
  pdf.text(blockLines, margin + 4, y + 5.2, { lineHeightFactor: 1.25 });
  y += height + 4;
}

function callout(title, text, tone = "teal") {
  const isAmber = tone === "amber";
  const fill = isAmber ? amberPale : pale;
  const accent = isAmber ? amber : teal;
  const lines = pdf.splitTextToSize(text, contentWidth - 10);
  const height = 13 + lines.length * 4;
  pdf.setFillColor(...fill);
  pdf.setDrawColor(...accent);
  pdf.roundedRect(margin, y, contentWidth, height, 2, 2, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...accent);
  pdf.text(title.toUpperCase(), margin + 5, y + 6);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.8);
  pdf.setTextColor(...dark);
  pdf.text(lines, margin + 5, y + 11, { lineHeightFactor: 1.25 });
  y += height + 5;
}

function numbered(items) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    pdf.setFillColor(...teal);
    pdf.circle(margin + 3, y - 1.2, 2.6, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    pdf.text(String(index + 1), margin + 3, y - 0.25, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(...dark);
    const lines = pdf.splitTextToSize(item, contentWidth - 10);
    pdf.text(lines, margin + 9, y, { lineHeightFactor: 1.25 });
    y += lines.length * 4 + 3;
  }
  y += 1;
}

// Page 1
addHeader("Target architecture and requirements");
pdf.setFont("helvetica", "bold");
pdf.setFontSize(22);
pdf.setTextColor(...dark);
pdf.text("IT Deployment Guide", margin, y + 2);
y += 11;
pdf.setFontSize(12);
pdf.setTextColor(...teal);
pdf.text("ULA Claims Hub - Internal Windows VM", margin, y);
y += 8;
paragraph("Production URL: https://ula.company.local", { bold: true, size: 10.5, after: 5 });
callout(
  "Objective",
  "Host the application permanently on an internal VM, provide one trusted HTTPS address to all LAN/VPN users, keep Node.js and application storage private, and ensure automatic restart and recoverable backups.",
);

heading("Target request path", 13);
const boxY = y;
const boxes = [
  { x: margin, w: 39, title: "EMPLOYEES", detail: "Browser / LAN" },
  { x: margin + 47, w: 45, title: "IIS + HTTPS", detail: "ula.company.local:443" },
  { x: margin + 100, w: 39, title: "NODE APP", detail: "127.0.0.1:8787" },
  { x: margin + 147, w: 31, title: "POSTGRES", detail: "SQL + uploads" },
];
for (const box of boxes) {
  pdf.setFillColor(...pale);
  pdf.setDrawColor(...teal);
  pdf.roundedRect(box.x, boxY, box.w, 19, 2, 2, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.8);
  pdf.setTextColor(...teal);
  pdf.text(box.title, box.x + box.w / 2, boxY + 7, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.3);
  pdf.setTextColor(...dark);
  pdf.text(box.detail, box.x + box.w / 2, boxY + 13, { align: "center" });
}
for (let index = 0; index < boxes.length - 1; index += 1) {
  const from = boxes[index];
  const to = boxes[index + 1];
  pdf.setDrawColor(...teal);
  pdf.line(from.x + from.w + 1, boxY + 9.5, to.x - 2, boxY + 9.5);
  pdf.line(to.x - 4, boxY + 8, to.x - 2, boxY + 9.5);
  pdf.line(to.x - 4, boxY + 11, to.x - 2, boxY + 9.5);
}
y += 26;

heading("IT-provided infrastructure", 13);
bullets([
  "Windows Server VM with a static IP, 4 vCPU, 8 GB RAM minimum, expandable disk, and LAN/VPN-only access.",
  "Internal DNS A record: ula.company.local -> VM static IP. Use this name only if IT owns and manages the company.local DNS zone.",
  "Internally trusted TLS certificate whose Subject Alternative Name includes ula.company.local.",
  "IIS with URL Rewrite and Application Request Routing (ARR), bound to HTTPS port 443.",
  "Dedicated non-administrator service account, automatic service recovery, monitoring, and nightly backups.",
]);

heading("Network exposure", 13);
const colWidth = (contentWidth - 8) / 2;
labelValue("Allowed from LAN/VPN", "TCP 443 to the VM", margin, colWidth);
labelValue("Not exposed", "TCP 8787; bind Node to 127.0.0.1", margin + colWidth + 8, colWidth);
y += 18;
callout("Canonical URL", "APP_BASE_URL must be exactly https://ula.company.local - no localhost, port number, or trailing slash.");

// Page 2
newPage("Application and reverse-proxy setup");
heading("1. Install and build the application", 14);
paragraph("Recommended application location: C:\\Apps\\ULA. Install an IT-approved current Node.js LTS release, then run:");
codeBlock([
  "cd C:\\Apps\\ULA",
  "npm ci",
  "npm run build",
  "npm start",
]);

heading("2. Production environment", 14);
codeBlock([
  "NODE_ENV=production",
  "HOST=127.0.0.1",
  "PORT=8787",
  "APP_BASE_URL=https://ula.company.local",
  "DATABASE_URL=postgres://ula_app:<password>@db-host:5432/ula",
  "DATABASE_SSL=true",
  "DATABASE_RUNTIME_ROLE=ula_app",
  "VITE_SQL_BACKEND=true",
]);
bullets([
  "Create PostgreSQL with separate migration-owner and runtime roles. The runtime role must not own the schema, be superuser, or have BYPASSRLS.",
  "Store .env only on the VM. Do not send .env, secrets, .data, or local state to IT.",
  "Keep all email, AI-provider, and API credentials server-side; never prefix secrets with VITE_.",
  "Build after VITE_SQL_BACKEND=true is set, then restart the service after changing .env.",
], { size: 8.8 });

heading("3. PostgreSQL setup and migration", 14);
codeBlock([
  "create database ula;",
  "create role ula_migrator login password '<migration-secret>';",
  "create role ula_app login password '<runtime-secret>';",
  "alter database ula owner to ula_migrator;",
  "set DATABASE_URL and DATABASE_SSL=true",
  "npm run db:migrate",
  "npm run db:check",
]);
bullets([
  "Run migration and grants with the migration owner. DATABASE_RUNTIME_ROLE defaults to ula_app.",
  "The connectivity check must return ok:true before the application service is started.",
  "PostgreSQL stores authentication, claims, documents, leave, employee, and audit data in production.",
], { size: 8.8 });

heading("4. Configure IIS", 14);
numbered([
  "Install IIS, URL Rewrite, and ARR; enable ARR proxy functionality.",
  "Create the ula.company.local site and bind HTTPS port 443 to its matching internal certificate.",
  "Proxy every request path to http://127.0.0.1:8787 while preserving the original host and forwarding the HTTPS scheme.",
  "Redirect HTTP port 80 to HTTPS, disable directory browsing, and configure request-size limits to accommodate claim uploads.",
  "Allow inbound TCP 443 from approved LAN/VPN ranges. Do not create an inbound firewall rule for 8787.",
]);

heading("5. Run Node as a Windows service", 14);
paragraph("Use the organization's approved Windows service wrapper or service-management platform:");
const serviceY = y;
pdf.setFillColor(247, 249, 249);
pdf.setDrawColor(...line);
pdf.roundedRect(margin, serviceY, contentWidth, 35, 2, 2, "FD");
y += 7;
labelValue("Working directory", "C:\\Apps\\ULA", margin + 5, 50);
labelValue("Command", "npm start", margin + 65, 35);
labelValue("Startup", "Automatic; restart on failure", margin + 110, 60);
y += 16;
labelValue("Identity", "Dedicated non-admin account", margin + 5, 70);
labelValue("Required access", "Read app files; no secret export access", margin + 85, 85);
y = serviceY + 41;
callout("Operational rule", "Do not use npm run dev in production. The service working directory must remain C:\\Apps\\ULA because persistent paths are resolved from the application root.");

// Page 3
newPage("Security, backup, validation, and handover");
heading("Production security gate", 14);
callout(
  "Must complete before go-live",
  "Production uses PostgreSQL and server-authoritative authentication. Local JSON state, quick-login personas, seeded temporary credentials, and direct authentication-database synchronization are disabled for production.",
  "amber",
);
bullets([
  "Confirm quick/demo login and seeded temporary credentials are absent from the production build and database.",
  "Never expose password hashes or permit unauthenticated replacement of authentication state.",
  "Enforce administrator authorization for account creation, role changes, access revocation, and password reset.",
  "Enable security headers, login/audit logging, session expiry, and least-privilege filesystem permissions.",
], { size: 8.8, after: 3 });

heading("Persistence and backup", 14);
paragraph("Critical path: PostgreSQL database plus the uploads directory", { bold: true, after: 2 });
bullets([
  "Back up PostgreSQL nightly with pg_dump in custom format; retain encrypted off-host copies and multiple restore points.",
  "Back up the uploads directory separately. Do not back up or transmit .env, secrets, node_modules, dist, or .data as application state.",
  "Restore with pg_restore into a clean database, run npm run db:migrate, restore uploads, and perform the connectivity and health checks.",
  "Perform and document a restore test on a staging VM. Store secrets in the approved IT secret manager and reissue them during recovery.",
], { size: 8.8 });

heading("Acceptance checklist", 14);
const checks = [
  "DNS resolves ula.company.local to the VM.",
  "HTTPS certificate is trusted with no browser warning.",
  "http://127.0.0.1:8787/api/health returns {\"ok\":true} on the VM.",
  "npm run db:check returns ok:true and identifies the expected database and runtime user.",
  "Port 443 works from LAN/VPN; port 8787 is blocked remotely.",
  "Two workstations see the same employee, claim, and uploaded document data.",
  "Email links open https://ula.company.local.",
  "The app returns automatically after a VM reboot.",
  "A backup has been restored successfully in a test location.",
];
for (const check of checks) {
  pdf.setDrawColor(...teal);
  pdf.rect(margin, y - 3, 3, 3);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.6);
  pdf.setTextColor(...dark);
  pdf.text(check, margin + 6, y);
  y += 5.2;
}
y += 2;

heading("Useful verification commands", 12);
codeBlock([
  "# On the VM",
  "Invoke-WebRequest http://127.0.0.1:8787/api/health",
  "# From an employee workstation",
  "Resolve-DnsName ula.company.local",
  "Test-NetConnection ula.company.local -Port 443",
]);

pdf.setFont("helvetica", "bold");
pdf.setFontSize(8);
pdf.setTextColor(...slate);
pdf.text("MICROSOFT REFERENCES", margin, y);
y += 5;
pdf.setFont("helvetica", "normal");
pdf.setFontSize(7.5);
pdf.setTextColor(...teal);
pdf.textWithLink("DNS resource records", margin, y, { url: "https://learn.microsoft.com/windows-server/networking/dns/manage-resource-records" });
pdf.text(" | ", margin + 29, y);
pdf.textWithLink("AD Certificate Services", margin + 33, y, { url: "https://learn.microsoft.com/windows-server/identity/ad-cs/active-directory-certificate-services-overview" });
pdf.text(" | ", margin + 68, y);
pdf.textWithLink("IIS ARR reverse proxy", margin + 72, y, { url: "https://learn.microsoft.com/iis/extensions/url-rewrite-module/reverse-proxy-with-url-rewrite-v2-and-application-request-routing" });

addFooter();
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.from(pdf.output("arraybuffer")));
console.log(outputPath);
