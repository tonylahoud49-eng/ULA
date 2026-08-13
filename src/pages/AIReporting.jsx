import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  Link2,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import DocumentUploader from "@/components/DocumentUploader";
import { REPORT_WORKFLOW_ROLES, reportReadiness } from "@/lib/reportTemplates";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims", "Requires Review", "Unclassified"];
const STEPS = ["Select Claim", "Upload Evidence", "AI Analysis", "Review & Edit", "Generate Report"];

export default function AIReporting() {
  const [step, setStep] = useState(0);
  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [edited, setEdited] = useState({});
  const [generating, setGenerating] = useState(false);
  const navigate = useNavigate();
  const readiness = useMemo(() => reportReadiness(edited || {}, documents), [edited, documents]);

  useEffect(() => {
    appClient.entities.Claim.list("-created_date", 100)
      .then(setClaims)
      .catch((error) => toast({ variant: "destructive", title: "Claims could not be loaded", description: error.message }));
  }, []);

  const selectClaim = async (id) => {
    setSelectedClaimId(id);
    const selected = await appClient.entities.Claim.get(id);
    setClaim(selected);
    setEdited(selected);
    setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: id }));
    setAnalysis(null);
    setAnalysisError("");
  };

  const createClaim = async () => {
    const year = new Date().getFullYear();
    const number = `ULA-${year}-${String(claims.length + 1).padStart(4, "0")}`;
    const created = await appClient.entities.Claim.create({ claim_number: number, title: "New AI Claim", business_line: "Unclassified", status: "New", priority: "Medium" });
    await selectClaim(created.id);
    setClaims((current) => [created, ...current]);
  };

  const reloadDocs = async () => {
    setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: selectedClaimId }));
  };

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
      const response = await appClient.functions.invoke("analyseClaim", { claim_id: selectedClaimId });
      clearTimeout(timer1);
      clearTimeout(timer2);
      setAnalysisProgress({ active: true, progress: 100, stage: "Analysis complete! Finalizing suggestions...", step: 4, totalSteps: 4 });
      await new Promise((r) => setTimeout(r, 300));
      setAnalysis(response.data.analysis);
      await selectClaim(selectedClaimId);
      setAnalysis(response.data.analysis);
      const suggestions = response.data.analysis.suggested_claim_data || {};
      setEdited((current) => Object.fromEntries(Object.entries({ ...current, ...suggestions }).map(([key, value]) => {
        const existing = current[key];
        const canSuggest = existing === undefined || existing === null || existing === "" || (key === "business_line" && existing === "Unclassified");
        return [key, canSuggest ? value : existing];
      })));
      setStep(3);
    } catch (error) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      const message = error.response?.data?.error || error.message;
      setAnalysisError(message);
      toast({ variant: "destructive", title: "Analysis could not be completed", description: message });
    } finally {
      setAnalyzing(false);
      setAnalysisProgress({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
    }
  };

  const saveEdits = async () => {
    const updated = await appClient.entities.Claim.update(selectedClaimId, edited);
    setClaim(updated);
    setEdited(updated);
    toast({ title: "Claim data saved", description: "The controlled draft will use these reviewed values." });
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      await appClient.entities.Claim.update(selectedClaimId, edited);
      await appClient.functions.invoke("generateReport", { claim_id: selectedClaimId, edited_data: edited });
      navigate(`/claims/${selectedClaimId}`);
    } catch (error) {
      toast({ variant: "destructive", title: "Draft report could not be generated", description: error.response?.data?.error || error.message });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Controlled reporting workspace</h2>
          <p className="docket-subtitle">Register evidence, analyze every source with the configured document-understanding service, verify every suggestion, and generate a unified ULA draft for professional review.</p>
        </div>
        <span className="status-mark border-amber-300 bg-amber-50 text-amber-800"><ShieldCheck className="h-3.5 w-3.5" /> Human approval required</span>
      </div>

      <Stepper step={step} />

      {step === 0 && (
        <Card className="docket-surface overflow-hidden shadow-none">
          <div className="flex flex-col justify-between gap-3 border-b bg-muted/35 p-5 sm:flex-row sm:items-center">
            <div><h3 className="font-heading text-xl font-semibold">Select a claim</h3><p className="mt-1 text-xs text-muted-foreground">The business line determines the unified report template.</p></div>
            <Button onClick={createClaim}><Wand2 /> Create New AI Claim</Button>
          </div>
          <div className="max-h-[430px] divide-y overflow-y-auto scrollbar-thin">
            {claims.length ? claims.map((item) => (
              <button key={item.id} type="button" onClick={() => selectClaim(item.id)} className={`w-full border-l-2 p-4 text-left transition-colors ${selectedClaimId === item.id ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/40"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{item.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.claim_number}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.business_line} · {item.status}</p>
              </button>
            )) : <div className="p-10 text-center text-sm text-muted-foreground">No claims registered yet.</div>}
          </div>
          {selectedClaimId && <div className="flex justify-end border-t p-5"><Button onClick={() => setStep(1)}>Continue <ArrowRight /></Button></div>}
        </Card>
      )}

      {step === 1 && claim && (
        <div className="space-y-4">
          <Card className="docket-surface border-primary/25 bg-primary/5 p-4 shadow-none">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div><p className="docket-label">Active claim</p><h3 className="font-heading text-lg font-semibold">{claim.title} ({claim.claim_number})</h3></div>
              <p className="text-xs text-muted-foreground">{claim.business_line} · {documents.length} evidence file(s)</p>
            </div>
          </Card>
          <DocumentUploader claimId={selectedClaimId} documents={documents} onChanged={reloadDocs} />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft /> Change claim</Button>
            <Button onClick={() => setStep(2)} disabled={!documents.length}>Continue to AI Analysis <ArrowRight /></Button>
          </div>
        </div>
      )}

      {step === 2 && claim && (
        <Card className="docket-surface p-8 text-center shadow-none">
          {analyzing ? (
            <div className="mx-auto max-w-lg space-y-4 py-4 text-left">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="h-5 w-5 animate-spin text-primary" />
                  <h3 className="font-heading text-lg font-semibold uppercase tracking-wider">AI Evidence Analysis in Progress</h3>
                </div>
                <span className="font-mono text-sm font-bold text-primary">{analysisProgress.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${analysisProgress.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{analysisProgress.stage}</span>
                <span className="font-mono text-[0.7rem]">Step {analysisProgress.step} of {analysisProgress.totalSteps}</span>
              </div>
            </div>
          ) : (
            <><FileText className="mx-auto mb-4 h-11 w-11 text-primary" /><h3 className="font-heading text-xl font-semibold">Ready to review {documents.length} source document(s)</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">All registered evidence is submitted to the configured AI provider for content-based classification and extraction. Unsupported facts remain marked for confirmation.</p>{analysisError && <div className="mx-auto mt-4 max-w-xl rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left text-sm text-destructive" role="alert"><strong>AI analysis unavailable.</strong> {analysisError.replace(/^AI analysis unavailable\s*[—-]\s*/i, "")}</div>}<Button onClick={runAnalysis} className="mt-5"><Sparkles /> Run AI Analysis</Button></>
          )}
          <div className="mt-6 flex justify-center"><Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft /> Back to upload</Button></div>
        </Card>
      )}

      {step === 3 && claim && <ReviewStep analysis={analysis} edited={edited} setEdited={setEdited} readiness={readiness} onSave={saveEdits} onBack={() => setStep(2)} onNext={() => setStep(4)} />}

      {step === 4 && claim && (
        <Card className="docket-surface overflow-hidden shadow-none">
          <div className="border-b bg-muted/35 px-6 py-5 text-left">
            <div className="flex items-start gap-3"><CheckCircle className="mt-0.5 h-6 w-6 text-primary" /><div><h3 className="font-heading text-xl font-semibold">Generate controlled draft</h3><p className="mt-1 text-sm text-muted-foreground">{readiness.template.name} · {readiness.overallProgress}% template readiness · {documents.length} registered sources</p></div></div>
          </div>
          <div className="grid sm:grid-cols-4">
            {REPORT_WORKFLOW_ROLES.map((role) => (
              <div key={role.id} className="border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                <p className="docket-label">{role.label}</p>
                <p className="mt-2 text-xs text-muted-foreground">{role.id === "investigator" ? edited.surveyor || "To be assigned" : role.id === "preparer" ? edited.prepared_by || "Current author" : role.id === "reviewer" ? edited.reviewed_by || "To be assigned" : edited.approved_by || "To be assigned"}</p>
              </div>
            ))}
          </div>
          <div className="border-t p-6 text-center">
            <p className="mx-auto max-w-2xl text-sm text-muted-foreground">The generated document remains a draft. Cause, coverage, adjustment, liability, recommendations, and conclusion require professional review; only an authorized approver may issue the final version.</p>
            <Button onClick={generateReport} disabled={generating} className="mt-5">{generating ? <><Loader2 className="animate-spin" /> Generating report…</> : <><Sparkles /> Generate Draft Report</>}</Button>
            <div className="mt-5"><Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft /> Back to review</Button></div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stepper({ step }) {
  return (
    <ol className="docket-surface grid overflow-hidden rounded-lg sm:grid-cols-5" aria-label="Report workflow">
      {STEPS.map((label, index) => (
        <li key={label} className={`flex min-w-0 items-center gap-3 border-b p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${index === step ? "bg-primary/5" : ""}`}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${index < step ? "border-primary bg-primary text-primary-foreground" : index === step ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>{index < step ? <CheckCircle className="h-4 w-4" /> : index + 1}</span>
          <span className={`truncate text-xs font-semibold ${index <= step ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function ReviewStep({ analysis, edited, setEdited, readiness, onSave, onBack, onNext }) {
  const set = (key, value) => setEdited({ ...edited, [key]: value });
  const number = (key, value) => setEdited({ ...edited, [key]: value === "" ? undefined : Number(value) });
  const confidenceClass = analysis?.confidence >= 80 ? "text-emerald-700" : analysis?.confidence >= 60 ? "text-amber-700" : "text-red-700";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="docket-surface border-primary/30 bg-primary/5 p-4 shadow-none">
          <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold">Template classification: <span className="text-primary">{analysis?.template_name || readiness.template.name}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{analysis?.summary || "Completeness analysis has not been run."}</p></div>{analysis && <div className="text-right"><p className="docket-label">Confidence</p><p className={`font-heading text-2xl font-semibold ${confidenceClass}`}>{analysis.confidence}%</p></div>}</div>
          {analysis?.missing_documents?.length > 0 && <div className="mt-3 flex items-start gap-2 border-t border-primary/20 pt-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Evidence categories still required:</strong> {analysis.missing_documents.join(", ")}</span></div>}
          {analysis?.warnings?.length > 0 && <div className="mt-3 border-t border-primary/20 pt-3 text-left text-xs text-amber-800"><strong>Review warnings:</strong><ul className="mt-1 list-disc space-y-1 pl-5">{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        </Card>
        <ReadinessPanel readiness={readiness} />
      </div>

      <Card className="docket-surface overflow-hidden shadow-none">
        <div className="flex flex-col justify-between gap-3 border-b bg-muted/35 p-5 sm:flex-row sm:items-center"><div><h3 className="font-heading text-xl font-semibold">Review extracted and entered facts</h3><p className="mt-1 text-xs text-muted-foreground">Empty values remain explicit gaps. Saving does not approve any professional determination.</p></div><Button size="sm" variant="outline" onClick={onSave}>Save Changes</Button></div>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          <RField label="Business Line"><Select value={edited.business_line || "Unclassified"} onValueChange={(value) => set("business_line", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_LINES.map((line) => <SelectItem key={line} value={line}>{line}</SelectItem>)}</SelectContent></Select></RField>
          <RField label="Insured"><Input value={edited.insured || ""} onChange={(event) => set("insured", event.target.value)} /></RField>
          <RField label="Insurer"><Input value={edited.insurer || ""} onChange={(event) => set("insurer", event.target.value)} /></RField>
          <RField label="Broker"><Input value={edited.broker || ""} onChange={(event) => set("broker", event.target.value)} /></RField>
          <RField label="Policy Number"><Input value={edited.policy_number || ""} onChange={(event) => set("policy_number", event.target.value)} /></RField>
          <RField label="Policy Limit"><Input type="number" value={edited.policy_limit || ""} onChange={(event) => number("policy_limit", event.target.value)} /></RField>
          <RField label="Deductible"><Input type="number" value={edited.deductible || ""} onChange={(event) => number("deductible", event.target.value)} /></RField>
          <RField label="Date of Loss"><Input type="date" value={edited.date_of_loss || ""} onChange={(event) => set("date_of_loss", event.target.value)} /></RField>
          <RField label="Date of Intimation"><Input type="date" value={edited.date_of_intimation || ""} onChange={(event) => set("date_of_intimation", event.target.value)} /></RField>
          <RField label="Surveyor / Investigator"><Input value={edited.surveyor || ""} onChange={(event) => set("surveyor", event.target.value)} /></RField>
          <RField label="Prepared By"><Input value={edited.prepared_by || ""} onChange={(event) => set("prepared_by", event.target.value)} /></RField>
          <RField label="Reviewed By"><Input value={edited.reviewed_by || ""} onChange={(event) => set("reviewed_by", event.target.value)} /></RField>
          <RField label="Approved By"><Input value={edited.approved_by || ""} onChange={(event) => set("approved_by", event.target.value)} /></RField>
          <RField label="Country"><Input value={edited.country || ""} onChange={(event) => set("country", event.target.value)} /></RField>
          <RField label="Vessel Name"><Input value={edited.vessel_name || ""} onChange={(event) => set("vessel_name", event.target.value)} /></RField>
          <RField label="Container Number"><Input value={edited.container_number || ""} onChange={(event) => set("container_number", event.target.value)} /></RField>
          <RField label="Port of Loading"><Input value={edited.port_of_loading || ""} onChange={(event) => set("port_of_loading", event.target.value)} /></RField>
          <RField label="Port of Discharge"><Input value={edited.port_of_discharge || ""} onChange={(event) => set("port_of_discharge", event.target.value)} /></RField>
          <RField label="Claim Amount"><Input type="number" value={edited.claim_amount || ""} onChange={(event) => number("claim_amount", event.target.value)} /></RField>
          <div className="sm:col-span-2 xl:col-span-3"><RField label="Cause of Loss — professional review required"><Textarea value={edited.cause_of_loss || ""} onChange={(event) => set("cause_of_loss", event.target.value)} rows={3} /></RField></div>
        </div>
      </Card>

      {analysis?.evidence_sources?.length > 0 && (
        <Card className="docket-surface overflow-hidden shadow-none">
          <div className="border-b bg-muted/35 px-5 py-4"><h3 className="font-heading text-xl font-semibold">Evidence provenance</h3><p className="mt-1 text-xs text-muted-foreground">Each AI suggestion is linked to the document and supporting passage that produced it.</p></div>
          <div className="divide-y">{analysis.evidence_sources.map((source) => <div key={source.id} className="grid gap-2 px-5 py-3 text-xs sm:grid-cols-[70px_1fr_1.4fr_auto] sm:items-start"><span className="font-mono text-muted-foreground">{source.id}</span><span className="font-semibold">{source.field}</span><span className="text-muted-foreground"><span className="font-semibold text-foreground">{source.source}</span>{source.matched_text && <span className="mt-1 block leading-5">“{source.matched_text}”</span>}</span><span className="flex items-center gap-1 text-primary"><Link2 className="h-3.5 w-3.5" /> {source.review_state}</span></div>)}</div>
        </Card>
      )}

      <div className="flex justify-between"><Button variant="outline" onClick={onBack}><ArrowLeft /> Back</Button><Button onClick={onNext}>Continue to Report <ArrowRight /></Button></div>
    </div>
  );
}

function ReadinessPanel({ readiness }) {
  return (
    <Card className="docket-surface overflow-hidden shadow-none">
      <div className="border-b bg-muted/35 px-4 py-3"><p className="docket-label">Template readiness</p><p className="mt-1 font-heading text-3xl font-semibold">{readiness.overallProgress}%</p></div>
      <div className="grid grid-cols-2"><div className="border-r p-3"><p className="docket-label">Fields</p><p className="mt-1 text-sm font-semibold">{readiness.fieldProgress}%</p></div><div className="p-3"><p className="docket-label">Documents</p><p className="mt-1 text-sm font-semibold">{readiness.documentProgress}%</p></div></div>
    </Card>
  );
}

function RField({ label, children }) {
  return <div><Label className="text-xs font-semibold">{label}</Label><div className="mt-1.5">{children}</div></div>;
}
