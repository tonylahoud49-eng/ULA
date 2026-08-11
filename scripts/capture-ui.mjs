import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = "http://127.0.0.1:4173";
const reviewDir = path.resolve(".impeccable/review");
const target = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(`${baseUrl}/login`)}`, { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const consoleErrors = [];
let messageId = 0;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleErrors.push({ type: "exception", text: message.params.exceptionDetails?.text, detail: message.params.exceptionDetails?.exception?.description });
  }
  if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
    consoleErrors.push({ type: message.params.type, text: message.params.args.map((argument) => argument.value || argument.description).join(" ") });
  }
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry.level)) {
    consoleErrors.push({ type: message.params.entry.level, text: message.params.entry.text, source: message.params.entry.source });
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
await send("Page.navigate", { url: `${baseUrl}/login` });
await delay(1200);

const now = new Date().toISOString();
const database = {
  Claim: [
    { id: "c1", claim_number: "ULA-2026-0148", title: "Water damage to industrial pumps", business_line: "Marine Cargo (Non-Reefer)", status: "Report Draft", priority: "High", insured: "Demo Assured", insurer: "Demo Insurer", broker: "Demo Broker", policy_number: "MC-DEMO-0148", date_of_loss: "2026-05-12", date_of_intimation: "2026-05-13", surveyor: "Jordan Reed", country: "Lebanon", vessel_name: "Demo Vessel", port_of_loading: "Demo Origin", port_of_discharge: "Demo Destination", claim_amount: 128450, deductible: 5000, missing_documents: ["Notice of Claim"], ai_confidence: 78, created_date: now, updated_date: now },
    { id: "c2", claim_number: "ULA-2026-0147", title: "Commercial premises fire", business_line: "Property", status: "Pending Documents", priority: "Critical", insured: "Demo Property Co.", insurer: "Demo Insurer", surveyor: "Maya Laurent", claim_amount: 310000, missing_documents: ["Fire or Incident Report", "Invoices and Quotations"], created_date: now, updated_date: now },
    { id: "c3", claim_number: "ULA-2026-0146", title: "Bulk cargo shortage", business_line: "Bulk Vessel", status: "Under Investigation", priority: "High", insured: "Demo Trading Co.", insurer: "Demo Insurer", surveyor: "Jordan Reed", claim_amount: 845000, missing_documents: [], created_date: now, updated_date: now },
    { id: "c4", claim_number: "ULA-2026-0145", title: "Employee fidelity review", business_line: "Fidelity Claims", status: "New", priority: "Medium", insured: "Demo Services Co.", insurer: "Demo Insurer", surveyor: "Unassigned", claim_amount: 72000, missing_documents: [], created_date: now, updated_date: now },
    { id: "c5", claim_number: "ULA-2026-0144", title: "Yacht machinery damage", business_line: "Yacht", status: "Report Final", priority: "Medium", insured: "Demo Yacht Owner", insurer: "Demo Insurer", surveyor: "Avery Stone", claim_amount: 54000, missing_documents: [], created_date: now, updated_date: now }
  ],
  ClaimDocument: [
    { id: "d1", claim_id: "c1", file_name: "Policy Schedule.pdf", file_type: "Policy", category: "Policy Document", file_url: "indexeddb:d1", storage_key: "d1", storage_provider: "indexeddb", created_date: now, updated_date: now },
    { id: "d2", claim_id: "c1", file_name: "Bill of Lading.pdf", file_type: "Bill of Lading", category: "Shipping Document", file_url: "indexeddb:d2", storage_key: "d2", storage_provider: "indexeddb", created_date: now, updated_date: now },
    { id: "d3", claim_id: "c1", file_name: "Survey Photograph.jpg", file_type: "Photo", category: "Photo Evidence", file_url: "indexeddb:d3", storage_key: "d3", storage_provider: "indexeddb", created_date: now, updated_date: now }
  ],
  Employee: [
    { id: "e1", name: "Jordan Reed", email: "jordan@example.test", department: "Claims", role: "Loss Adjuster", annual_leave_total: 15, annual_leave_used: 4, toil_balance: 1 },
    { id: "e2", name: "Maya Laurent", email: "maya@example.test", department: "Survey", role: "Technical Specialist", annual_leave_total: 15, annual_leave_used: 7, toil_balance: 2 }
  ],
  Leave: [],
  ReportVersion: [
    { id: "r1", claim_id: "c1", version_number: 1, status: "Draft", issue_state: "Draft", template_id: "marine-non-reefer", template_name: "Marine Non-Reefer Cargo Report", evidence_count: 3, readiness: { overall_progress: 72 }, generated_by: "UI Review", content: "# ULA-2026-0148\n\n## Report Summary\n\nSynthetic review content.", created_date: now, updated_date: now }
  ],
  User: []
};
const auth = { accounts: [{ id: "audit-user", email: "review@ula.test", full_name: "UI Review", passwordHash: "", role: "admin" }], sessionUserId: "audit-user", pendingVerification: null, resetRequests: {} };

await send("Runtime.evaluate", {
  expression: `localStorage.setItem('ula_claims_hub_database_v1', ${JSON.stringify(JSON.stringify(database))}); localStorage.setItem('ula_claims_hub_auth_v1', ${JSON.stringify(JSON.stringify(auth))});`,
});

const visit = async (route, wait = 900) => {
  await send("Page.navigate", { url: `${baseUrl}${route}` });
  await delay(wait);
  const result = await send("Runtime.evaluate", { expression: `({ title: document.title, bodyText: document.body.innerText.slice(0, 240), width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`, returnByValue: true });
  return result.result.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
const routeChecks = {};
for (const route of ["/", "/claims", "/claims/c1", "/ai-reporting", "/annual-leave"]) {
  routeChecks[route] = await visit(route);
}
await visit("/");
const desktop = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(path.join(reviewDir, "desktop.png"), Buffer.from(desktop.data, "base64"));

await visit("/claims/c1");
const claimDesktop = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(path.join(reviewDir, "claim-desktop.png"), Buffer.from(claimDesktop.data, "base64"));

await visit("/ai-reporting");
const reportingDesktop = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(path.join(reviewDir, "reporting-desktop.png"), Buffer.from(reportingDesktop.data, "base64"));

await visit("/login");
const authDesktop = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(path.join(reviewDir, "auth-desktop.png"), Buffer.from(authDesktop.data, "base64"));

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
await visit("/");
const mobile = await send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
await fs.writeFile(path.join(reviewDir, "mobile.png"), Buffer.from(mobile.data, "base64"));

await fs.writeFile(path.join(reviewDir, "route-checks.json"), JSON.stringify(routeChecks, null, 2));
await fs.writeFile(path.join(reviewDir, "console-findings.json"), JSON.stringify(consoleErrors, null, 2));
process.stdout.write(JSON.stringify({ routeChecks, consoleErrors }, null, 2));
socket.close();
