import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, FileText, ArrowRight, ArrowLeft, CheckCircle, AlertTriangle, Loader2, Wand2 } from "lucide-react";
import DocumentUploader from "@/components/DocumentUploader";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Fidelity Claims", "Unclassified"];
const STEPS = ["Select Claim", "Upload Evidence", "AI Analysis", "Review & Edit", "Generate Report"];

export default function AIReporting() {
  const [step, setStep] = useState(0);
  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [edited, setEdited] = useState({});
  const [generating, setGenerating] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const data = await appClient.entities.Claim.list("-created_date", 100);
      setClaims(data);
    })();
  }, []);

  const selectClaim = async (id) => {
    setSelectedClaimId(id);
    const c = await appClient.entities.Claim.get(id);
    setClaim(c);
    setEdited(c);
    setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: id }));
  };

  const createClaim = async () => {
    const number = `ULA-2026-${String(claims.length + 1).padStart(4, "0")}`;
    const c = await appClient.entities.Claim.create({ claim_number: number, title: "New AI Claim", business_line: "Unclassified", status: "New", priority: "Medium" });
    await selectClaim(c.id);
    setClaims([c, ...claims]);
  };

  const reloadDocs = async () => {
    setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: selectedClaimId }));
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await appClient.functions.invoke("analyseClaim", { claim_id: selectedClaimId });
      setAnalysis(res.data.analysis);
      await selectClaim(selectedClaimId);
      setStep(3);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const saveEdits = async () => {
    await appClient.entities.Claim.update(selectedClaimId, edited);
    setClaim(edited);
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      await saveEdits();
      await appClient.functions.invoke("generateReport", { claim_id: selectedClaimId, edited_data: edited });
      navigate(`/claims/${selectedClaimId}`);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-primary" /> AI Reporting</h2>
        <p className="text-sm text-muted-foreground mt-1">Upload evidence, let AI classify and extract, review every field, then generate a ULA-standard draft report.</p>
      </div>

      <Stepper step={step} />

      {step === 0 && (
        <Card className="p-6">
          <h3 className="font-heading font-semibold mb-4">Select or create a claim to report on</h3>
          <Button onClick={createClaim} className="ula-gradient text-white mb-4"><Wand2 className="w-4 h-4 mr-2" /> Create New AI Claim</Button>
          <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
            {claims.map((c) => (
              <button key={c.id} onClick={() => selectClaim(c.id)} className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedClaimId === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{c.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.claim_number}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.business_line} · {c.status}</p>
              </button>
            ))}
          </div>
          {selectedClaimId && (
            <div className="mt-5 flex justify-end">
              <Button onClick={() => setStep(1)} className="ula-gradient text-white">Continue <ArrowRight className="w-4 h-4 ml-2" /></Button>
            </div>
          )}
        </Card>
      )}

      {step === 1 && claim && (
        <div className="space-y-4">
          <Card className="p-4 bg-primary/5 border-primary/20">
            <p className="text-sm">Reporting on <span className="font-medium">{claim.title}</span> ({claim.claim_number})</p>
          </Card>
          <DocumentUploader claimId={selectedClaimId} documents={documents} onChanged={reloadDocs} />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
            <Button onClick={() => setStep(2)} disabled={!documents.length} className="ula-gradient text-white">Continue <ArrowRight className="w-4 h-4 ml-2" /></Button>
          </div>
        </div>
      )}

      {step === 2 && claim && (
        <Card className="p-8 text-center">
          {analyzing ? (
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <h3 className="font-heading font-semibold">AI is analyzing your evidence…</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">Combining all documents and photos, running OCR and computer vision, classifying the business line, and extracting every key field.</p>
            </div>
          ) : (
            <>
              <FileText className="w-12 h-12 text-primary mx-auto mb-4" />
              <h3 className="font-heading font-semibold">Ready to analyze {documents.length} document(s)</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">The AI will combine all uploaded evidence before classifying and extracting. It never relies on photos alone and never fabricates missing information.</p>
              <Button onClick={runAnalysis} className="ula-gradient text-white mt-5"><Sparkles className="w-4 h-4 mr-2" /> Run AI Analysis</Button>
            </>
          )}
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-2" /> Back to upload</Button>
          </div>
        </Card>
      )}

      {step === 3 && claim && (
        <ReviewStep analysis={analysis} edited={edited} setEdited={setEdited} onSave={saveEdits} onBack={() => setStep(2)} onNext={() => setStep(4)} />
      )}

      {step === 4 && claim && (
        <Card className="p-8 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h3 className="font-heading font-semibold">Generate the draft report?</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">The AI will produce a complete ULA-style draft report with cover page, summary, findings, cause of loss, policy analysis, adjustment, liability, recommendations, and outstanding documents. You will be able to review and approve it before it becomes final.</p>
          <Button onClick={generateReport} disabled={generating} className="ula-gradient text-white mt-5">
            {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating report…</> : <><Sparkles className="w-4 h-4 mr-2" /> Generate Draft Report</>}
          </Button>
          <div className="mt-6 flex justify-center">
            <Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft className="w-4 h-4 mr-2" /> Back to review</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stepper({ step }) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {STEPS.map((s, i) => (
        <React.Fragment key={s}>
          <div className={`flex items-center gap-2 shrink-0 ${i <= step ? "text-primary" : "text-muted-foreground"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${i < step ? "ula-gradient text-white" : i === step ? "border-2 border-primary text-primary" : "border border-border"}`}>
              {i < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            <span className="text-xs font-medium hidden sm:inline">{s}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`h-px w-6 sm:w-10 ${i < step ? "bg-primary" : "bg-border"}`} />}
        </React.Fragment>
      ))}
    </div>
  );
}

function ReviewStep({ analysis, edited, setEdited, onSave, onBack, onNext }) {
  const set = (k, v) => setEdited({ ...edited, [k]: v });
  const num = (k, v) => setEdited({ ...edited, [k]: v === "" ? undefined : Number(v) });
  const confidenceColor = (c) => c >= 80 ? "text-emerald-600" : c >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-4">
      {analysis && (
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">AI Classification: <span className="text-primary">{analysis.business_line}</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">{analysis.summary}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className={`text-lg font-bold ${confidenceColor(analysis.confidence)}`}>{analysis.confidence}%</p>
            </div>
          </div>
          {analysis.missing_documents && analysis.missing_documents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-primary/20 flex items-start gap-2 text-xs text-amber-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>Missing documents:</strong> {analysis.missing_documents.join(", ")}</span>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-sm">Review &amp; Edit Extracted Information</h3>
          <Button size="sm" variant="outline" onClick={onSave}>Save Changes</Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Every field below was extracted by the AI. Edit any value before generating the report. Empty fields indicate information not found in the evidence.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <RField label="Business Line"><Select value={edited.business_line || "Unclassified"} onValueChange={(v) => set("business_line", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_LINES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></RField>
          <RField label="Insured"><Input value={edited.insured || ""} onChange={(e) => set("insured", e.target.value)} /></RField>
          <RField label="Insurer"><Input value={edited.insurer || ""} onChange={(e) => set("insurer", e.target.value)} /></RField>
          <RField label="Broker"><Input value={edited.broker || ""} onChange={(e) => set("broker", e.target.value)} /></RField>
          <RField label="Policy Number"><Input value={edited.policy_number || ""} onChange={(e) => set("policy_number", e.target.value)} /></RField>
          <RField label="Policy Limit"><Input type="number" value={edited.policy_limit || ""} onChange={(e) => num("policy_limit", e.target.value)} /></RField>
          <RField label="Deductible"><Input type="number" value={edited.deductible || ""} onChange={(e) => num("deductible", e.target.value)} /></RField>
          <RField label="Date of Loss"><Input type="date" value={edited.date_of_loss || ""} onChange={(e) => set("date_of_loss", e.target.value)} /></RField>
          <RField label="Date of Intimation"><Input type="date" value={edited.date_of_intimation || ""} onChange={(e) => set("date_of_intimation", e.target.value)} /></RField>
          <RField label="Surveyor"><Input value={edited.surveyor || ""} onChange={(e) => set("surveyor", e.target.value)} /></RField>
          <RField label="Country"><Input value={edited.country || ""} onChange={(e) => set("country", e.target.value)} /></RField>
          <RField label="Vessel Name"><Input value={edited.vessel_name || ""} onChange={(e) => set("vessel_name", e.target.value)} /></RField>
          <RField label="Container Number"><Input value={edited.container_number || ""} onChange={(e) => set("container_number", e.target.value)} /></RField>
          <RField label="Port of Loading"><Input value={edited.port_of_loading || ""} onChange={(e) => set("port_of_loading", e.target.value)} /></RField>
          <RField label="Port of Discharge"><Input value={edited.port_of_discharge || ""} onChange={(e) => set("port_of_discharge", e.target.value)} /></RField>
          <RField label="Claim Amount"><Input type="number" value={edited.claim_amount || ""} onChange={(e) => num("claim_amount", e.target.value)} /></RField>
          <div className="col-span-2 md:col-span-3"><RField label="Cause of Loss"><Textarea value={edited.cause_of_loss || ""} onChange={(e) => set("cause_of_loss", e.target.value)} rows={2} /></RField></div>
        </div>
      </Card>

      {analysis && analysis.evidence_sources && analysis.evidence_sources.length > 0 && (
        <Card className="p-5">
          <h3 className="font-heading font-semibold text-sm mb-3">Evidence Sources &amp; Confidence</h3>
          <div className="space-y-1.5">
            {analysis.evidence_sources.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                <span className="font-medium">{e.field}</span>
                <span className="text-muted-foreground">{e.source}</span>
                <span className={`font-medium ${e.confidence === "High" ? "text-emerald-600" : e.confidence === "Medium" ? "text-amber-600" : "text-red-600"}`}>{e.confidence}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-2" /> Back</Button>
        <Button onClick={onNext} className="ula-gradient text-white">Continue to Report <ArrowRight className="w-4 h-4 ml-2" /></Button>
      </div>
    </div>
  );
}

function RField({ label, children }) {
  return <div><Label className="text-xs">{label}</Label><div className="mt-1">{children}</div></div>;
}
