import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Sparkles, AlertTriangle, Save, CheckCircle } from "lucide-react";
import DocumentUploader from "@/components/DocumentUploader";
import ReactMarkdown from "react-markdown";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Fidelity Claims", "Unclassified"];
const STATUSES = ["New", "Under Investigation", "Pending Documents", "Report Draft", "Report Final", "Closed"];

export default function ClaimDetail() {
  const { id } = useParams();
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

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
    try {
      const res = await appClient.functions.invoke("analyseClaim", { claim_id: id });
      setAnalysis(res.data.analysis);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setAnalyzing(false);
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
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/claims"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-heading font-bold">{claim.title}</h2>
            <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{claim.claim_number}</span>
          </div>
          <p className="text-sm text-muted-foreground">{claim.business_line} · {claim.insured || "Insured TBD"}</p>
        </div>
        <Button onClick={runAnalysis} disabled={analyzing || !documents.length} className="ula-gradient text-white hover:opacity-90">
          <Sparkles className="w-4 h-4 mr-2" /> {analyzing ? "Analyzing…" : "Run AI Analysis"}
        </Button>
      </div>

      {analysis && (
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">AI Analysis Complete — Confidence: {analysis.confidence}%</p>
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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
          <TabsTrigger value="report">Report Versions ({reports.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="p-5">
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
          <ReportSection claimId={id} reports={reports} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
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

function ReportSection({ claimId, reports, onChanged }) {
  const [generating, setGenerating] = useState(false);
  const [activeReport, setActiveReport] = useState(null);

  const generate = async () => {
    setGenerating(true);
    try {
      await appClient.functions.invoke("generateReport", { claim_id: claimId });
      await onChanged();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (r) => {
    await appClient.entities.ReportVersion.update(r.id, { status: "Final" });
    await appClient.entities.Claim.update(claimId, { status: "Report Final" });
    await onChanged();
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-sm">Report Versions</h3>
        <Button onClick={generate} disabled={generating} className="ula-gradient text-white hover:opacity-90">
          <Sparkles className="w-4 h-4 mr-2" /> {generating ? "Generating…" : "Generate Draft Report"}
        </Button>
      </div>
      {reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm">No report versions yet. Run AI analysis first, then generate a draft.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.slice().reverse().map((r) => (
            <div key={r.id} className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium text-sm">Version {r.version_number}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${r.status === "Final" ? "bg-emerald-100 text-emerald-700" : "bg-purple-100 text-purple-700"}`}>{r.status}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setActiveReport(activeReport === r.id ? null : r.id)}>
                    {activeReport === r.id ? "Hide" : "View"}
                  </Button>
                  {r.status !== "Final" && <Button size="sm" onClick={() => approve(r)} className="ula-gradient text-white"><CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve Final</Button>}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Generated by {r.generated_by} · {new Date(r.created_date).toLocaleDateString()}</p>
              {activeReport === r.id && (
                <div className="mt-3 pt-3 border-t border-border prose prose-sm max-w-none">
                  <ReactMarkdown>{r.content}</ReactMarkdown>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
