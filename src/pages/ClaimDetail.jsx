import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import remarkGfm from "remark-gfm";
import ulaLogo from "@/assets/ula-logo.png";
import ulaSkyscrapers from "@/assets/ula-skyscrapers.png";
import ulaJusticeStatue from "@/assets/ula-justice-statue.jpg";
import masterReportTemplate from "../../samples/templates/ULA-Master-Report.docx?url";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, FileText, Sparkles, AlertTriangle, Save, CheckCircle, ClipboardCheck, ShieldCheck } from "lucide-react";
import DocumentUploader from "@/components/DocumentUploader";
import ReactMarkdown from "react-markdown";
import { toast } from "@/components/ui/use-toast";
import { REPORT_LIFECYCLE, reportReadiness } from "@/lib/reportTemplates";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims", "Requires Review", "Unclassified"];
const STATUSES = ["New", "Under Investigation", "Pending Documents", "Report Draft", "Report Final", "Closed"];

const formatDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
};

const xmlEscape = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const wordXml = (value) => xmlEscape(value).split(/\r?\n/).join("<w:br/>");

const parseMarkdownSections = (markdown) => {
  const sections = {};
  let current = null;
  String(markdown || "").split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      current = heading[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      sections[current] = "";
      return;
    }
    if (!current) return;
    sections[current] = `${sections[current]}${sections[current] ? "\n" : ""}${line}`.trimEnd();
  });
  return sections;
};

const loadLogoDataUrl = async () => {
  try {
    const response = await fetch(ulaLogo);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

export default function ClaimDetail() {
  const { id } = useParams();
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const readiness = useMemo(() => reportReadiness(claim || {}, documents), [claim, documents]);

  const load = async () => {
    try {
      const c = await appClient.entities.Claim.get(id);
      setClaim(c);
      setForm(c);
      setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: id }));
      setReports(await appClient.entities.ReportVersion.filter({ claim_id: id }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysisProgress({ active: true, progress: 15, stage: "Ingesting evidence files & extracting OCR metadata...", step: 1, totalSteps: 4 });
    const timer1 = setTimeout(() => {
      setAnalysisProgress({ active: true, progress: 45, stage: "Classifying document categories & confidence scoring...", step: 2, totalSteps: 4 });
    }, 500);
    const timer2 = setTimeout(() => {
      setAnalysisProgress({ active: true, progress: 75, stage: "Extracting salient facts & policy coverage positions...", step: 3, totalSteps: 4 });
    }, 1200);

    try {
      const res = await appClient.functions.invoke("analyseClaim", { claim_id: id });
      clearTimeout(timer1);
      clearTimeout(timer2);
      setAnalysisProgress({ active: true, progress: 100, stage: "Analysis complete! Updating claim docket...", step: 4, totalSteps: 4 });
      await new Promise((r) => setTimeout(r, 300));
      setAnalysis(res.data.analysis);
      await load();
    } catch (e) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      const message = e.response?.data?.error || e.message;
      setAnalysisError(message);
      toast({ variant: "destructive", title: "Analysis could not be completed", description: message });
    } finally {
      setAnalyzing(false);
      setAnalysisProgress({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
    }
  };

  const saveClaim = async () => {
    await appClient.entities.Claim.update(id, form);
    setEditing(false);
    await load();
  };

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!claim) return <div className="text-center py-20 text-muted-foreground">Claim not found.</div>;

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div className="flex min-w-0 items-start gap-3">
          <Link to="/claims"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="docket-title truncate">{claim.title}</h2>
              <span className="status-mark border-border bg-card font-mono text-muted-foreground">{claim.claim_number}</span>
            </div>
            <p className="docket-subtitle">{claim.business_line} · {claim.insured || "Insured requires confirmation"} · {readiness.template.name}</p>
          </div>
        </div>
        <Button onClick={runAnalysis} disabled={analyzing || !documents.length} className="ula-gradient text-white hover:opacity-90">
          <Sparkles className="w-4 h-4 mr-2" /> {analyzing ? "Analyzing…" : "Run AI Analysis"}
        </Button>
      </div>

      {analysisProgress.active && (
        <Card className="docket-surface border-primary/40 bg-primary/5 p-4 shadow-none transition-all">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="w-4 h-4 animate-spin text-primary" />
                <span className="font-heading text-sm font-semibold uppercase tracking-wider">AI Claim Analysis in Progress</span>
              </div>
              <span className="font-mono text-xs font-bold text-primary">{analysisProgress.progress}%</span>
            </div>
            <div className="w-full bg-primary/15 h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-500 ease-out rounded-full"
                style={{ width: `${analysisProgress.progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground">
              <span>{analysisProgress.stage}</span>
              <span className="font-mono text-[0.68rem]">Step {analysisProgress.step} of {analysisProgress.totalSteps}</span>
            </div>
          </div>
        </Card>
      )}

      <ReleaseChain claim={claim} documents={documents} reports={reports} readiness={readiness} />

      {analysis && (
        <Card className="docket-surface border-primary/30 bg-primary/5 p-4 shadow-none">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold">AI analysis complete — classification confidence: {analysis.confidence}%</p>
              <p className="text-xs text-muted-foreground mt-1">{analysis.summary}</p>
              {analysis.missing_documents && analysis.missing_documents.length > 0 && (
                <div className="mt-2 flex items-start gap-2 text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <span>Missing: {analysis.missing_documents.join(", ")}</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {analysisError && !analysis && (
        <Card className="docket-surface border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-none" role="alert">
          <strong>AI analysis unavailable.</strong> {analysisError.replace(/^AI analysis unavailable\s*[—-]\s*/i, "")}
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          <TabsTrigger value="report">Report Versions ({reports.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="docket-surface p-5 shadow-none">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-sm">Claim Details</h3>
              {editing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(false); setForm(claim); }}>Cancel</Button>
                  <Button size="sm" onClick={saveClaim} className="ula-gradient text-white"><Save className="w-3.5 h-3.5 mr-1" /> Save</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              )}
            </div>
            {editing ? <EditForm form={form} setForm={setForm} /> : <ViewGrid claim={claim} />}
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentUploader claimId={id} documents={documents} onChanged={load} />
        </TabsContent>

        <TabsContent value="report" className="space-y-4">
          <ReportSection claimId={id} claim={claim} reports={reports} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReleaseChain({ claim, documents, reports, readiness }) {
  const hasFinal = reports.some((report) => report.status === "Final");
  const currentIndex = hasFinal ? 4 : reports.length ? 3 : claim.ai_confidence ? 2 : documents.length ? 1 : 0;

  return (
    <section className="docket-surface overflow-hidden rounded-lg" aria-label="Claim release progress">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid sm:grid-cols-5">
          {REPORT_LIFECYCLE.map((stage, index) => {
            const complete = index < currentIndex || (hasFinal && index === currentIndex);
            const current = index === currentIndex && !hasFinal;
            return (
              <div key={stage.id} className={`relative border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r ${current ? "bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[0.68rem] font-semibold ${complete ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {complete ? <CheckCircle className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className={`text-xs font-semibold ${complete || current ? "text-foreground" : "text-muted-foreground"}`}>{stage.label}</span>
                </div>
                <p className="mt-2 text-[0.68rem] leading-4 text-muted-foreground">{complete ? "Complete" : current ? "Current gate" : "Pending"}</p>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-4 border-t bg-muted/35 px-4 py-3 lg:border-l lg:border-t-0">
          <div>
            <p className="docket-label">Template readiness</p>
            <p className="mt-1 font-heading text-2xl font-semibold">{readiness.overallProgress}%</p>
          </div>
          <div className="approval-stamp">{hasFinal ? <ShieldCheck className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}<span className="sr-only">{hasFinal ? "Final" : "Controlled draft"}</span></div>
        </div>
      </div>
    </section>
  );
}

function ViewGrid({ claim }) {
  const fields = [
    ["Business Line", claim.business_line], ["Status", claim.status], ["Priority", claim.priority],
    ["Insured", claim.insured], ["Insurer", claim.insurer], ["Broker", claim.broker],
    ["Policy Number", claim.policy_number], ["Policy Limit", claim.policy_limit ? `$${claim.policy_limit.toLocaleString()}` : null],
    ["Deductible", claim.deductible ? `$${claim.deductible.toLocaleString()}` : null],
    ["Date of Loss", claim.date_of_loss], ["Date of Intimation", claim.date_of_intimation],
    ["Surveyor", claim.surveyor], ["Country", claim.country],
    ["Prepared By", claim.prepared_by], ["Reviewed By", claim.reviewed_by], ["Approved By", claim.approved_by],
    ["Vessel", claim.vessel_name], ["Container", claim.container_number],
    ["Port of Loading", claim.port_of_loading], ["Port of Discharge", claim.port_of_discharge],
    ["Cause of Loss", claim.cause_of_loss], ["Claim Amount", claim.claim_amount ? `$${claim.claim_amount.toLocaleString()}` : null],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
      {fields.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className="text-sm font-medium mt-0.5">{value || <span className="text-muted-foreground/60 italic">Not provided</span>}</p>
        </div>
      ))}
    </div>
  );
}

function EditForm({ form, setForm }) {
  const set = (k, v) => setForm({ ...form, [k]: v });
  const num = (k, v) => setForm({ ...form, [k]: v === "" ? undefined : Number(v) });
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <Field label="Business Line"><Select value={form.business_line} onValueChange={(v) => set("business_line", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_LINES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Low","Medium","High","Critical"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Insured"><Input value={form.insured || ""} onChange={(e) => set("insured", e.target.value)} /></Field>
      <Field label="Insurer"><Input value={form.insurer || ""} onChange={(e) => set("insurer", e.target.value)} /></Field>
      <Field label="Broker"><Input value={form.broker || ""} onChange={(e) => set("broker", e.target.value)} /></Field>
      <Field label="Policy Number"><Input value={form.policy_number || ""} onChange={(e) => set("policy_number", e.target.value)} /></Field>
      <Field label="Policy Limit"><Input type="number" value={form.policy_limit || ""} onChange={(e) => num("policy_limit", e.target.value)} /></Field>
      <Field label="Deductible"><Input type="number" value={form.deductible || ""} onChange={(e) => num("deductible", e.target.value)} /></Field>
      <Field label="Date of Loss"><Input type="date" value={form.date_of_loss || ""} onChange={(e) => set("date_of_loss", e.target.value)} /></Field>
      <Field label="Date of Intimation"><Input type="date" value={form.date_of_intimation || ""} onChange={(e) => set("date_of_intimation", e.target.value)} /></Field>
      <Field label="Surveyor"><Input value={form.surveyor || ""} onChange={(e) => set("surveyor", e.target.value)} /></Field>
      <Field label="Country"><Input value={form.country || ""} onChange={(e) => set("country", e.target.value)} /></Field>
      <Field label="Prepared By"><Input value={form.prepared_by || ""} onChange={(e) => set("prepared_by", e.target.value)} /></Field>
      <Field label="Reviewed By"><Input value={form.reviewed_by || ""} onChange={(e) => set("reviewed_by", e.target.value)} /></Field>
      <Field label="Approved By"><Input value={form.approved_by || ""} onChange={(e) => set("approved_by", e.target.value)} /></Field>
      <Field label="Vessel Name"><Input value={form.vessel_name || ""} onChange={(e) => set("vessel_name", e.target.value)} /></Field>
      <Field label="Container Number"><Input value={form.container_number || ""} onChange={(e) => set("container_number", e.target.value)} /></Field>
      <Field label="Port of Loading"><Input value={form.port_of_loading || ""} onChange={(e) => set("port_of_loading", e.target.value)} /></Field>
      <Field label="Port of Discharge"><Input value={form.port_of_discharge || ""} onChange={(e) => set("port_of_discharge", e.target.value)} /></Field>
      <Field label="Claim Amount"><Input type="number" value={form.claim_amount || ""} onChange={(e) => num("claim_amount", e.target.value)} /></Field>
      <div className="col-span-2 md:col-span-3"><Field label="Cause of Loss"><Textarea value={form.cause_of_loss || ""} onChange={(e) => set("cause_of_loss", e.target.value)} rows={2} /></Field></div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>;
}

function ControlledReportPreview({ report, data }) {
  const sections = parseMarkdownSections(report.content);
  const entries = Object.entries(sections).filter(([key]) => !["cover_page", "document_control", "version_history", "claim_salient_details"].includes(key));
  const initials = String(data.insured_name || "ULA").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "ULA";
  const value = (item) => item || "Requires confirmation";

  return (
    <div className="report-reader border-t">
      <aside className="report-contents" aria-label="Report contents">
        <div className="report-contents-brand">
          <img src={ulaLogo} alt="United Loss Adjusters" />
          <span>Controlled report</span>
        </div>
        <p className="report-contents-label">Contents</p>
        <a href="#report-cover">Cover & control</a>
        {entries.map(([key]) => <a key={key} href={`#section-${key}`}>{key.replaceAll("_", " ")}</a>)}
        <div className="report-contents-meta">
          <span>ULA ref.</span>
          <strong>{value(data.claim_number)}</strong>
          <span>Issue state</span>
          <strong>{data.report_issue_state}</strong>
        </div>
      </aside>

      <div className="report-sheet-wrap">
        <article className="report-sheet" aria-label={`${data.form_code} version ${data.version_number}`}>
          <header className="report-cover" id="report-cover">
            <div className="report-cover-topline">
              <img src={ulaLogo} alt="United Loss Adjusters & Surveyors" />
              <span>{data.report_issue_state} controlled issue</span>
            </div>
            <div className="report-cover-body">
              <p className="report-kicker">United Loss Adjusters & Surveyors</p>
              <h1>{data.form_code}</h1>
              <div className="report-cover-rule" />
              <p className="report-cover-claim">{value(data.insured_name)}</p>
              <p className="report-cover-description">{value(data.loss_or_interest_description)}</p>
            </div>
            <dl className="report-cover-facts">
              <div><dt>ULA reference</dt><dd>{value(data.claim_number)}</dd></div>
              <div><dt>Business line</dt><dd>{value(data.business_line)}</dd></div>
              <div><dt>Date of loss</dt><dd>{formatDate(data.date_of_loss) || "Requires confirmation"}</dd></div>
              <div><dt>Issue date</dt><dd>{data.issue_date}</dd></div>
            </dl>
          </header>

          <section className="report-control-section" aria-label="Document control">
            <div className="report-section-heading"><span>01</span><h2>Document control</h2></div>
            <div className="report-control-grid">
              <div className="report-control-card"><span>Issue state</span><strong>{data.report_issue_state}</strong><small>Version {data.version_number}</small></div>
              <div className="report-control-card"><span>Insurer</span><strong>{value(data.insurer)}</strong><small>Broker: {value(data.broker)}</small></div>
              <div className="report-control-card report-initials"><span>Claim file</span><strong>{initials}</strong><small>{value(data.policy_number)}</small></div>
            </div>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead><tr><th>Responsibility</th><th>Assigned person</th><th>Professional designation</th><th>Status</th></tr></thead>
                <tbody>
                  {(report.assignments || []).map((assignment) => <tr key={assignment.role}><td>{assignment.label}</td><td>{assignment.name}</td><td>{assignment.designation}</td><td>Pending sign-off</td></tr>)}
                  {!report.assignments?.length && <tr><td colSpan="4">Responsibility assignments require confirmation.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="report-disclaimer">This report is issued without prejudice to the rights and defences of all parties concerned. Professional findings, policy response and quantum remain subject to the recorded approval workflow.</p>
          </section>

          <section className="report-version-section">
            <div className="report-section-heading"><span>02</span><h2>Version history</h2></div>
            <div className="report-version-line"><strong>Version {data.version_number}</strong><span>{data.issue_date}</span><span>{data.report_issue_state}</span><span>{data.revision_reason || "Initial controlled draft"}</span></div>
          </section>

          <div className="report-main-content">
            {entries.map(([key, body], index) => (
              <section className="report-content-section" id={`section-${key}`} key={key}>
                <div className="report-section-heading"><span>{String(index + 3).padStart(2, "0")}</span><h2>{key.replaceAll("_", " ")}</h2></div>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "Requires confirmation."}</ReactMarkdown>
              </section>
            ))}
          </div>

          <section className="report-closing-page" aria-label="ULA corporate information" style={{ background: "#ffffff", padding: "2.5rem 2rem", borderTop: "4px solid #7faea4", textAlign: "center" }}>
            <img src={ulaLogo} alt="United Loss Adjusters & Surveyors" style={{ width: "120px", height: "auto", margin: "0 auto 1.25rem" }} />
            <div style={{ textAlign: "left", maxWidth: "28rem", margin: "0 auto 1.5rem", fontSize: "0.8rem", color: "#374151", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 0.5rem" }}><strong>Contact person:</strong> Petro Zaarour, Director</p>
              <p style={{ margin: "0 0 0.5rem" }}><strong>UK:</strong> 71-75 Shelton Street, Covent Garden, London WC2H 9JQ<br /><strong>Middle East:</strong> Mina Tower, Ain Warda Street, Beirut, Lebanon</p>
              <p style={{ margin: "0" }}><strong>24/7 Claims:</strong> +44 (0) 20 3287 3326 | claims@unitedlossadjusters.com</p>
            </div>
            <img src={ulaJusticeStatue} alt="Lady Justice" style={{ width: "200px", height: "220px", objectFit: "cover", margin: "0 auto 1.25rem", borderRadius: "2px", border: "1px solid #e5e7eb" }} />
            <p style={{ maxWidth: "30rem", margin: "0 auto", fontSize: "0.68rem", color: "#6b7280", lineHeight: 1.5 }}>
              United Loss Adjusters &amp; Surveyors Limited (ULA). This controlled report is issued without prejudice to the rights and defences of all parties concerned.
            </p>
          </section>

          <footer className="report-footer">
            <span>Date: {data.issue_date}</span>
            <span>United Loss Adjusters &amp; Surveyors 2023©</span>
            <span>ULA-FORM-011-01</span>
            <span>Version {data.version_number}</span>
          </footer>
        </article>
      </div>
    </div>
  );
}

function ReportSection({ claimId, claim, reports, onChanged }) {
  const [generating, setGenerating] = useState(false);
  const [activeReport, setActiveReport] = useState(null);
  const [exportReport, setExportReport] = useState(null);
  const [exportProgress, setExportProgress] = useState({ active: false, format: "", progress: 0, stage: "" });

  const pdfCoverRef = React.useRef(null);
  const pdfControlRef = React.useRef(null);
  const pdfBodyRef = React.useRef(null);
  const pdfAboutRef = React.useRef(null);
  const pdfClosingRef = React.useRef(null);

  const getReportData = (report) => {
    const sections = parseMarkdownSections(report?.content || "");
    const insurerName = report?.insurer || claim?.insurer || "";
    const insuredName = report?.insured_name || claim?.insured || "";
    const brokerName = report?.broker || claim?.broker || "";
    const claimTitle = claim?.title || claim?.cause_of_loss || report?.template_name || "Survey & Claim Report";
    
    // Clean, professional header matching the corporate sample: "M/s. [Insurer] – M/s. [Insured] – [Claim Title]"
    const applicantClean = insurerName ? (insurerName.startsWith("M/s.") ? insurerName : `M/s. ${insurerName}`) : "";
    const insuredClean = insuredName ? (insuredName.startsWith("M/s.") ? insuredName : `M/s. ${insuredName}`) : "";
    const subjectClean = String(claimTitle).replace(/^[#\s*_-]+|[#\s*_-]+$/g, "").replace(/\n.*/g, "").trim();
    const headerTitle = [applicantClean, insuredClean, subjectClean].filter(Boolean).join(" – ") || "United Loss Adjusters & Surveyors Report";

    return {
      claim_number: report?.claim_number || claim?.claim_number || "",
      business_line: report?.business_line || claim?.business_line || "",
      insured_name: insuredName,
      insurer: insurerName,
      broker: brokerName,
      header_title: headerTitle,
      policy_number: report?.policy_number || claim?.policy_number || "",
      currency: report?.currency || claim?.currency || "USD",
      date_of_loss: report?.date_of_loss || claim?.date_of_loss || "",
      claimed_amount: report?.claimed_amount || claim?.claim_amount || "",
      adjusted_amount: report?.adjusted_amount || claim?.adjusted_amount || "",
      issue_date: formatDate(report?.approved_date || report?.created_date || new Date()),
      version_number: report?.version_number || "1",
      report_issue_state: report?.issue_state || report?.status || "Draft",
      legal_entity: "United Loss Adjusters & Surveyors",
      form_code: report?.template_name || "ULA Claim Report",
      investigator_name: report?.investigator_name || report?.assignments?.find((item) => item.role === "investigator")?.name || "Petro Zaarour",
      investigator_designation: report?.investigator_designation || report?.assignments?.find((item) => item.role === "investigator")?.designation || "Chartered Marine Surveyor & Loss Adjuster",
      preparer_name: report?.preparer_name || report?.assignments?.find((item) => item.role === "preparer")?.name || "Estefani Haddad",
      preparer_designation: report?.preparer_designation || report?.assignments?.find((item) => item.role === "preparer")?.designation || "Claims Administrator",
      reviewer_name: report?.reviewer_name || report?.assignments?.find((item) => item.role === "reviewer")?.name || "Annie Abdel Massih",
      reviewer_designation: report?.reviewer_designation || report?.assignments?.find((item) => item.role === "reviewer")?.designation || "Claims Director UKI",
      approver_name: report?.approver_name || report?.assignments?.find((item) => item.role === "approver")?.name || "Petro Zaarour",
      approver_designation: report?.approver_designation || report?.assignments?.find((item) => item.role === "approver")?.designation || "Chartered Engineer & Average Adjuster",
      investigator_signature: "",
      preparer_signature: "",
      reviewer_signature: "",
      approver_signature: "",
      investigator_date: formatDate(report?.created_date || new Date()),
      preparer_date: formatDate(report?.created_date || new Date()),
      reviewer_date: formatDate(report?.approved_date || report?.created_date || new Date()),
      approver_date: formatDate(report?.approved_date || report?.created_date || new Date()),
      revision_reason: report?.notes || "Initial controlled issue",
      cover: sections.cover || "",
      document_control: sections.document_control || "",
      version_history: sections.version_history || "",
      executive_summary: sections.executive_summary || "",
      claim_facts: sections.claim_facts || "",
      appointment: sections.appointment || "",
      investigation: sections.investigation || "",
      cause: sections.cause || "",
      coverage: sections.coverage || "",
      adjustment: sections.adjustment || "",
      conclusion: sections.conclusion || "",
      supporting_documents: sections.supporting_documents || "",
      outstanding_documents: sections.outstanding_documents || "",
      appendices: sections.appendices || "",
      corporate: sections.corporate || "",
      loss_or_interest_description: subjectClean,
    };
  };

  const baseFileName = (report, ext) => {
    const safeName = String(report?.template_name || "ULA Claim Report").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
    const version = report?.version_number ? `v${report.version_number}` : "report";
    return `${safeName || "ULA_Claim_Report"}_${version}.${ext}`;
  };

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = async (report) => {
    setExportProgress({ active: true, format: "MD", progress: 40, stage: "Building markdown structure..." });
    await new Promise((r) => setTimeout(r, 250));
    downloadBlob(new Blob([String(report?.content || "")], { type: "text/markdown;charset=utf-8" }), baseFileName(report, "md"));
    setExportProgress({ active: true, format: "MD", progress: 100, stage: "Markdown file downloaded" });
    await new Promise((r) => setTimeout(r, 400));
    setExportProgress({ active: false, format: "", progress: 0, stage: "" });
  };

  const exportTxt = async (report) => {
    setExportProgress({ active: true, format: "TXT", progress: 40, stage: "Building plain text content..." });
    await new Promise((r) => setTimeout(r, 250));
    downloadBlob(new Blob([String(report?.content || "")], { type: "text/plain;charset=utf-8" }), baseFileName(report, "txt"));
    setExportProgress({ active: true, format: "TXT", progress: 100, stage: "Text file downloaded" });
    await new Promise((r) => setTimeout(r, 400));
    setExportProgress({ active: false, format: "", progress: 0, stage: "" });
  };

  const exportDocx = async (report) => {
    try {
      setExportProgress({ active: true, format: "DOCX", progress: 20, stage: "Loading production DOCX master template..." });
      const response = await fetch(masterReportTemplate);
      if (!response.ok) throw new Error("The production report template could not be loaded.");
      setExportProgress({ active: true, format: "DOCX", progress: 50, stage: "Injecting claim data XML placeholders & footers..." });
      const templateBlob = await response.blob();
      const zip = await JSZip.loadAsync(templateBlob);
      const data = getReportData(report);
      const replacePlaceholders = async (entryName) => {
        const entry = zip.file(entryName);
        if (!entry) return;
        let xml = await entry.async("string");
        Object.entries(data).forEach(([key, value]) => {
          xml = xml.replaceAll(`{{${key}}}`, wordXml(value));
        });
        zip.file(entryName, xml);
      };
      await replacePlaceholders("word/document.xml");
      await replacePlaceholders("word/footer1.xml");
      setExportProgress({ active: true, format: "DOCX", progress: 85, stage: "Packing OpenXML document package..." });
      const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      downloadBlob(blob, baseFileName(report, "docx"));
      setExportProgress({ active: true, format: "DOCX", progress: 100, stage: "DOCX report downloaded" });
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      toast({ variant: "destructive", title: "DOCX export failed", description: err.message });
    } finally {
      setExportProgress({ active: false, format: "", progress: 0, stage: "" });
    }
  };

  const exportPdf = async (report) => {
    setExportProgress({ active: true, format: "PDF", progress: 10, stage: "Initializing corporate report canvas..." });
    setExportReport(report);
    
    await new Promise((resolve) => setTimeout(resolve, 400));

    try {
      const data = getReportData(report);
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const width = pdf.internal.pageSize.getWidth();
      const height = pdf.internal.pageSize.getHeight();

      // Page 1: Cover Page (Framed with corporate header & skyscrapers)
      setExportProgress({ active: true, format: "PDF", progress: 20, stage: "Rendering framed cover page..." });
      if (!pdfCoverRef.current) throw new Error("Export cover element not found in DOM");
      const coverCanvas = await html2canvas(pdfCoverRef.current, { scale: 2, useCORS: true });
      const coverImg = coverCanvas.toDataURL("image/png");
      pdf.addImage(coverImg, "PNG", 0, 0, width, height);

      // Page 2: Control, Version History & Salient Details
      setExportProgress({ active: true, format: "PDF", progress: 40, stage: "Rendering document control & salient details..." });
      if (!pdfControlRef.current) throw new Error("Export control element not found in DOM");
      const controlCanvas = await html2canvas(pdfControlRef.current, { scale: 2, useCORS: true });
      const controlImg = controlCanvas.toDataURL("image/png");
      pdf.addPage();
      pdf.addImage(controlImg, "PNG", 0, 0, width, height);

      // Pages 3 to N-2: Flowing Body Content
      setExportProgress({ active: true, format: "PDF", progress: 65, stage: "Processing flowing report body sections..." });
      if (!pdfBodyRef.current) throw new Error("Export body element not found in DOM");
      const bodyCanvas = await html2canvas(pdfBodyRef.current, { scale: 2, useCORS: true });
      
      const pageHeightCanvas = Math.floor(bodyCanvas.width * (1123 / 794));
      let srcY = 0;
      const bodyPagesCount = Math.ceil(bodyCanvas.height / pageHeightCanvas);

      for (let i = 0; i < bodyPagesCount; i++) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = bodyCanvas.width;
        sliceCanvas.height = pageHeightCanvas;
        const ctx = sliceCanvas.getContext("2d");

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, pageHeightCanvas);

        ctx.drawImage(
          bodyCanvas,
          0,
          srcY,
          bodyCanvas.width,
          pageHeightCanvas,
          0,
          0,
          bodyCanvas.width,
          pageHeightCanvas
        );

        const sliceImg = sliceCanvas.toDataURL("image/png");
        pdf.addPage();
        pdf.addImage(sliceImg, "PNG", 0, 0, width, height);

        srcY += pageHeightCanvas;
      }

      // Page N-1: About ULA Page
      setExportProgress({ active: true, format: "PDF", progress: 85, stage: "Rendering About ULA corporate summary..." });
      if (pdfAboutRef.current) {
        const aboutCanvas = await html2canvas(pdfAboutRef.current, { scale: 2, useCORS: true });
        const aboutImg = aboutCanvas.toDataURL("image/png");
        pdf.addPage();
        pdf.addImage(aboutImg, "PNG", 0, 0, width, height);
      }

      // Final Page: Closing Page (Framed with Lady Justice statue & offices)
      setExportProgress({ active: true, format: "PDF", progress: 95, stage: "Rendering closing contacts & Lady Justice seal..." });
      if (!pdfClosingRef.current) throw new Error("Export closing element not found in DOM");
      const closingCanvas = await html2canvas(pdfClosingRef.current, { scale: 2, useCORS: true });
      const closingImg = closingCanvas.toDataURL("image/png");
      pdf.addPage();
      pdf.addImage(closingImg, "PNG", 0, 0, width, height);

      // Add footers on all pages except the cover (page 1) and closing (last page)
      const totalPages = pdf.getNumberOfPages();
      for (let pageNum = 2; pageNum < totalPages; pageNum++) {
        pdf.setPage(pageNum);

        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, height - 36, width, 36, "F");

        const marginX = 48;
        pdf.setDrawColor(127, 174, 164);
        pdf.setLineWidth(0.8);
        pdf.line(marginX, height - 32, width - marginX, height - 32);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(107, 114, 128);
        pdf.text(
          `Date: ${data.issue_date} · United Loss Adjusters & Surveyors 2023© · ULA-FORM-011-01`,
          marginX,
          height - 18
        );
        pdf.text(
          `Page ${pageNum} of ${totalPages}`,
          width - marginX,
          height - 18,
          { align: "right" }
        );
      }

      pdf.save(baseFileName(report, "pdf"));
      setExportProgress({ active: true, format: "PDF", progress: 100, stage: "PDF export complete!" });
      await new Promise((r) => setTimeout(r, 400));
      toast({ title: "Success", description: "Production-ready PDF report exported successfully." });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "PDF export failed", description: error.message });
    } finally {
      setExportReport(null);
      setExportProgress({ active: false, format: "", progress: 0, stage: "" });
    }
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await appClient.functions.invoke("generateReport", { claim_id: claimId });
      await onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: "Draft report could not be generated", description: e.response?.data?.error || e.message });
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (r) => {
    const user = await appClient.auth.me();
    await appClient.entities.ReportVersion.update(r.id, {
      status: "Final",
      issue_state: "Final",
      approved_by: user.full_name || user.email,
      approved_date: new Date().toISOString(),
    });
    await appClient.entities.Claim.update(claimId, { status: "Report Final" });
    await onChanged();
  };

  return (
    <Card className="docket-surface p-5 shadow-none">
      <div className="mb-5 flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-heading text-xl font-semibold">Controlled report versions</h3>
          <p className="mt-1 text-xs text-muted-foreground">Issued versions remain immutable; subsequent corrections create a new controlled version.</p>
        </div>
        <Button onClick={generate} disabled={generating} className="ula-gradient text-white hover:opacity-90">
          <Sparkles className="w-4 h-4 mr-2" /> {generating ? "Generating…" : "Generate Draft Report"}
        </Button>
      </div>

      {exportProgress.active && (
        <Card className="docket-surface border-primary/40 bg-card p-4 shadow-sm transition-all mb-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="status-mark border-primary/40 bg-primary/10 text-primary font-mono text-xs font-bold">
                  {exportProgress.format}
                </span>
                <span className="font-heading text-sm font-semibold text-foreground">
                  Exporting Controlled Report ({exportProgress.format})
                </span>
              </div>
              <span className="font-mono text-xs font-bold text-primary">{exportProgress.progress}%</span>
            </div>
            <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300 ease-out rounded-full"
                style={{ width: `${exportProgress.progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{exportProgress.stage}</p>
          </div>
        </Card>
      )}

      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm">No report versions yet. Run AI analysis first, then generate a draft.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.slice().reverse().map((r) => (
            <article key={r.id} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex flex-col justify-between gap-3 border-b bg-muted/35 p-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-lg font-semibold">Version {r.version_number}</span>
                    <span className={`status-mark ${r.status === "Final" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-violet-300 bg-violet-50 text-violet-800"}`}>{r.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.template_name || "ULA Claim Report"} · {r.evidence_count ?? "—"} evidence items · {r.readiness?.overall_progress ?? "—"}% ready</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setActiveReport(activeReport === r.id ? null : r.id)}>
                    {activeReport === r.id ? "Hide" : "View"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportMarkdown(r)} disabled={!r.content}>
                    <Download className="w-3.5 h-3.5 mr-1" /> MD
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportTxt(r)} disabled={!r.content}>
                    TXT
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportDocx(r)} disabled={!r.content}>
                    DOCX
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportPdf(r)} disabled={!r.content}>
                    PDF
                  </Button>
                  {r.status !== "Final" && <Button size="sm" onClick={() => approve(r)} className="ula-gradient text-white"><CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve Final</Button>}
                </div>
              </div>
              <div className="grid border-b sm:grid-cols-4">
                {(r.assignments || []).map((assignment) => (
                  <div key={assignment.role} className="border-b p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <p className="docket-label">{assignment.label}</p>
                    <p className="mt-1 truncate text-xs font-semibold">{assignment.name}</p>
                  </div>
                ))}
                {!r.assignments?.length && <div className="p-3 text-xs text-muted-foreground">Legacy version without recorded responsibility assignments.</div>}
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">Generated by {r.generated_by} · {new Date(r.created_date).toLocaleDateString()}</p>
              {activeReport === r.id && <ControlledReportPreview report={r} data={getReportData(r)} />}
            </article>
          ))}
        </div>
      )}

      {/* Hidden container for PDF export */}
      {exportReport && (
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px", width: "794px" }}>
          {/* Page 1: Cover Page — Framed with sage border on left/right/bottom (NO TOP BORDER), top teal line, metadata table, logo tagline, and skyscrapers */}
          <div ref={pdfCoverRef} style={{ width: "794px", height: "1123px", background: "#85b2a9", padding: "0 32px 32px 32px", boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", background: "#ffffff", padding: "40px 48px 36px 48px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ width: "100%", height: "4px", background: "#7faea4", marginBottom: "22px" }} />
                <h1 style={{ margin: "0 0 20px", color: "#111827", fontFamily: "'Source Sans 3', Arial, sans-serif", fontSize: "22px", fontWeight: 700, lineHeight: 1.35, letterSpacing: "-0.01em" }}>
                  {getReportData(exportReport).header_title}
                </h1>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", fontFamily: "'Source Sans 3', sans-serif" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", width: "32%", fontWeight: 700, color: "#111827" }}>ULA reference:</td>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }}>{getReportData(exportReport).claim_number}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", fontWeight: 700, color: "#111827" }}>Applicant’s Name:</td>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }}>M/s. {getReportData(exportReport).insurer}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", fontWeight: 700, color: "#111827" }}>Policy Holder:</td>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }}>{getReportData(exportReport).broker || getReportData(exportReport).insured_name}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", fontWeight: 700, color: "#111827" }}>Assured’s Name:</td>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }}>M/s. {getReportData(exportReport).insured_name}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", fontWeight: 700, color: "#111827" }}>Policy No.:</td>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }}>{getReportData(exportReport).policy_number}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "6.5px 0", borderBottom: "1px solid #7faea4", color: "#374151" }} colSpan={2}>{getReportData(exportReport).issue_date}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ textAlign: "center", margin: "12px 0 8px" }}>
                <img src={ulaLogo} alt="ULA" style={{ width: "140px", height: "auto", margin: "0 auto 6px", display: "block" }} />
                <p style={{ color: "#1f8a79", fontSize: "11.5px", fontWeight: 700, margin: "6px 0 0", textAlign: "center" }}>
                  It’s about time you receive the quality of service and expertise your firm deserves.
                </p>
              </div>

              <div>
                <img src={ulaSkyscrapers} alt="ULA London Headquarters" style={{ width: "100%", height: "350px", objectFit: "cover", display: "block", borderRadius: "1px" }} />
              </div>
            </div>
          </div>

          {/* Page 2: Document Control & Version History & Claim Salient Details */}
          <div ref={pdfControlRef} style={{ width: "794px", height: "1123px", padding: "48px 56px", boxSizing: "border-box", background: "white", overflow: "hidden" }}>
            <div className="report-sheet" style={{ width: "100%", height: "100%", boxShadow: "none" }}>
              <section className="report-control-section" style={{ padding: "0 0 20px 0", borderBottom: "1px solid #d8e1dc" }}>
                <div className="report-section-heading"><span>01</span><h2>Document control</h2></div>
                <div className="report-control-grid">
                  <div className="report-control-card">
                    <span>Issue state</span>
                    <strong>{getReportData(exportReport).report_issue_state}</strong>
                    <small>Version {getReportData(exportReport).version_number}</small>
                  </div>
                  <div className="report-control-card">
                    <span>Insurer</span>
                    <strong>{getReportData(exportReport).insurer}</strong>
                    <small>Broker: {getReportData(exportReport).broker || "Direct"}</small>
                  </div>
                  <div className="report-control-card report-initials">
                    <span>Claim file</span>
                    <strong style={{ fontSize: "1.8rem" }}>
                      {String(getReportData(exportReport).insured_name || "ULA").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "ULA"}
                    </strong>
                    <small>{getReportData(exportReport).policy_number}</small>
                  </div>
                </div>
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Responsibility</th>
                        <th>Assigned person</th>
                        <th>Professional designation</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(exportReport.assignments || []).map((assignment) => (
                        <tr key={assignment.role}>
                          <td>{assignment.label}</td>
                          <td>{assignment.name}</td>
                          <td>{assignment.designation}</td>
                          <td>Signed & Validated</td>
                        </tr>
                      ))}
                      {!exportReport.assignments?.length && (
                        <tr>
                          <td colSpan="4">Responsibility assignments completed.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="report-version-section" style={{ padding: "20px 0", borderBottom: "1px solid #d8e1dc" }}>
                <div className="report-section-heading"><span>02</span><h2>Version history</h2></div>
                <div className="report-version-line">
                  <strong>Version {getReportData(exportReport).version_number}</strong>
                  <span>{getReportData(exportReport).issue_date}</span>
                  <span>{getReportData(exportReport).report_issue_state}</span>
                  <span>{getReportData(exportReport).revision_reason || "Controlled Loss Adjusting Survey Report"}</span>
                </div>
              </section>

              <section className="report-control-section" style={{ padding: "20px 0", border: 0 }}>
                <div className="report-section-heading"><span>03</span><h2>Claim Salient Details</h2></div>
                <div className="report-table-wrap">
                  <table className="report-table">
                    <tbody>
                      <tr>
                        <td style={{ width: "30%", fontWeight: "bold", background: "#f3f7f4" }}>Insurer / Applicant</td>
                        <td>{getReportData(exportReport).insurer}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Insured / Assured</td>
                        <td>{getReportData(exportReport).insured_name}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Broker / Agent</td>
                        <td>{getReportData(exportReport).broker || "Direct"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Business Line</td>
                        <td>{getReportData(exportReport).business_line}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Claimed Amount</td>
                        <td>{getReportData(exportReport).currency} {getReportData(exportReport).claimed_amount ? Number(getReportData(exportReport).claimed_amount).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "0.00"}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Net Adjusted Amount</td>
                        <td>{getReportData(exportReport).currency} {getReportData(exportReport).adjusted_amount ? Number(getReportData(exportReport).adjusted_amount).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "0.00"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>

          {/* Page 3: Flowing Body Content */}
          <div ref={pdfBodyRef} style={{ width: "794px", padding: "48px 56px", boxSizing: "border-box", background: "white" }}>
            <div className="report-sheet" style={{ width: "100%", boxShadow: "none" }}>
              <div className="report-main-content" style={{ padding: 0 }}>
                {Object.entries(parseMarkdownSections(exportReport.content))
                  .filter(([key]) => !["cover_page", "document_control", "version_history", "claim_salient_details", "about_ula"].includes(key))
                  .map(([key, body], index) => (
                    <section className="report-content-section" key={key} style={{ padding: "22px 0", borderBottom: "1px solid #d8e1dc" }}>
                      <div className="report-section-heading">
                        <span>{String(index + 4).padStart(2, "0")}</span>
                        <h2>{key.replaceAll("_", " ")}</h2>
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "Assessment documented in claim file."}</ReactMarkdown>
                    </section>
                  ))}
              </div>
            </div>
          </div>

          {/* Page N-1: About ULA Corporate Summary Page */}
          <div ref={pdfAboutRef} style={{ width: "794px", height: "1123px", padding: "48px 56px", boxSizing: "border-box", background: "white", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ width: "100%", height: "4px", background: "#7faea4", marginBottom: "20px" }} />
              <h1 style={{ margin: "0 0 16px", color: "#111827", fontFamily: "'Source Sans 3', sans-serif", fontSize: "28px", fontWeight: 700 }}>About ULA</h1>
              <p style={{ fontSize: "11.5px", lineHeight: 1.65, color: "#1f2937", margin: "0 0 12px" }}>
                <strong>United Loss Adjusters and Surveyors (ULA)</strong> is a leading international provider of Adjusters, Surveyors, Solicitors and Consultants, offering unrivalled technical and legal solutions with exclusive access to the London Market's leading specialists.
              </p>
              <p style={{ fontSize: "11.5px", lineHeight: 1.65, color: "#1f2937", margin: "0 0 12px" }}>
                Founded in 2002, with strategic head offices in the Middle East and the United Kingdom, today ULA is the strategic ally of a world leading legal firm (with offices in over 60 major countries) and the correspondent for a number of global technical service providers (with offices in 140+ countries), with principals including but not limited to Insurers, Reinsurers, Brokers, P&amp;I clubs, Ship Owners, Shipyards and Agencies.
              </p>
              <p style={{ fontSize: "11.5px", fontWeight: 700, color: "#1f8a79", margin: "14px 0 6px" }}>Lines of business:</p>
              <ul style={{ fontSize: "11px", lineHeight: 1.6, color: "#374151", margin: "0 0 12px", paddingLeft: "18px" }}>
                <li>Insurance &amp; Re-insurance</li>
                <li>Claims solutions and loss adjusting across all major lines: aviation, cargo, marine, property, fine arts and special risks claims</li>
                <li>Cargo &amp; Containers</li>
                <li>Marine &amp; Offshore</li>
                <li>Global Claim Recoveries &amp; Legal Support</li>
              </ul>
              <p style={{ fontSize: "11.5px", fontWeight: 700, color: "#1f8a79", margin: "14px 0 6px" }}>Our team:</p>
              <p style={{ fontSize: "11px", lineHeight: 1.6, color: "#374151", margin: "0 0 12px" }}>
                Our team of qualified professionals experienced in the fields of Marine, Insurance, Finance, Engineering and Law known and respected for their integrity and credibility. Supported by a highly mobile team strategically positioned where our services are needed, we are always available on short notice to deal promptly with your queries. ULA is independent to the core and can be trusted to express unbiased views, and is not influenced by stakeholders.
              </p>
              <p style={{ fontSize: "11.5px", fontWeight: 700, color: "#1f8a79", margin: "14px 0 6px" }}>ULA’s team members are recognised members of the following international institutions:</p>
              <ul style={{ fontSize: "10.5px", lineHeight: 1.55, color: "#374151", margin: "0", paddingLeft: "18px" }}>
                <li>The Association of Average Adjusters (AAA)</li>
                <li>The Bar Council of England and Wales</li>
                <li>The Chartered Insurance Institute (CII)</li>
                <li>The Chartered Institute of Loss Adjusters (CILA)</li>
                <li>The European Federation of Loss Adjusting Experts (FUEDI)</li>
                <li>The Institute of Marine Engineering, Science and Technology (IMarEST)</li>
                <li>The Royal Institution of Naval Architects (RINA)</li>
                <li>The Royal Institution of Chartered Surveyors (RICS)</li>
              </ul>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #7faea4", paddingTop: "12px", fontSize: "9.5px", color: "#6b7280" }}>
              <div>
                Date: {getReportData(exportReport).issue_date}<br />
                United Loss Adjusters &amp; Surveyors 2023©<br />
                ULA-FORM-011-01
              </div>
              <div style={{ alignSelf: "flex-end" }}>
                ULA Controlled Issue
              </div>
            </div>
          </div>

          {/* Final Page: Corporate Closing Page — Framed with sage border on left/right/bottom (NO TOP BORDER), Lady Justice statue & offices */}
          <div ref={pdfClosingRef} style={{ width: "794px", height: "1123px", background: "#85b2a9", padding: "0 32px 32px 32px", boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", background: "#ffffff", padding: "48px 48px 24px 48px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch" }}>
              <div style={{ textAlign: "center", marginBottom: "12px" }}>
                <img src={ulaLogo} alt="ULA" style={{ width: "140px", height: "auto", margin: "0 auto", display: "block" }} />
              </div>
              
              <div style={{ textAlign: "left", width: "100%", fontSize: "11px", color: "#1f2937", lineHeight: 1.55, marginBottom: "8px" }}>
                <p style={{ margin: "0 0 8px" }}>
                  <strong style={{ color: "#111827", fontSize: "11.5px" }}>Contact person</strong><br />
                  <span style={{ textDecoration: "underline", color: "#111827" }}>Petro Zaarour</span><br />
                  <span style={{ color: "#4b5563" }}>Director</span>
                </p>
                <p style={{ margin: "0 0 6px", fontSize: "10.5px" }}>
                  <strong>United Kingdom:</strong> 71-75 Shelton Street, Covent Garden | London, England - WC2H 9JQ<br />
                  <strong>Middle East:</strong> Mina Tower, Ain Warda Street | Beirut, Lebanon - WG2G+5CX
                </p>
                <p style={{ margin: "0 0 6px", fontSize: "10.5px" }}>
                  <strong>Registered name:</strong> United Loss Adjusters and Surveyors Ltd.
                </p>
                <p style={{ margin: "0 0 6px", fontSize: "10.5px" }}>
                  <strong>24/7 Contacts &amp; Claim Support</strong> – T: +44 (0) 20 3287 3326 | M/WhatsApp: +44 (0) 7 375 110 573<br />
                  <strong>Office E:</strong> <a href="mailto:claims@unitedlossadjusters.com" style={{ color: "#1f8a79", textDecoration: "underline" }}>claims@unitedlossadjusters.com</a><br />
                  <strong>W:</strong> <a href="https://www.unitedlossadjusters.com/" style={{ color: "#1f8a79", textDecoration: "underline" }}>https://www.unitedlossadjusters.com/</a>
                </p>
              </div>

              <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", margin: "6px 0 12px" }}>
                <img src={ulaJusticeStatue} alt="Lady Justice" style={{ width: "230px", height: "350px", objectFit: "contain", display: "block", margin: "0 auto" }} />
              </div>

              <div style={{ textAlign: "justify", width: "100%", fontSize: "7.8px", color: "#6b7280", lineHeight: 1.45, borderTop: "1px solid #e5e7eb", paddingTop: "8px" }}>
                <p style={{ margin: "0 0 4px" }}>
                  United Loss Adjusters &amp; Surveyors Ltd., ULA and any variants are trading names of United Loss Adjusters &amp; Surveyors, its subsidiaries and affiliates. United Loss Adjusters &amp; Surveyors is a limited company registered in England &amp; Wales (Reg. 14407381).
                </p>
                <p style={{ margin: 0 }}>
                  United Loss Adjusters &amp; Surveyors Limited (ULA), its affiliates and subsidiaries and their respective officers, employees or agents are, individually and collectively, referred to in this clause as 'ULA'. ULA assumes no responsibility and shall not be liable to any person for any loss, damage or expense caused by reliance on the information or advice in this document or howsoever provided, unless that person has signed a contract or had agreed on a written or oral proposal with the relevant ULA entity for the provision of this information or advice and in that case any responsibility or liability is exclusively on the terms and conditions set out in that contract, proposal or referenced terms and conditions.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
