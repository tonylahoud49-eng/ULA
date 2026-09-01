import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
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
import AIAnalysisProgressCard, { formatModelDisplayName } from "@/components/AIAnalysisProgressCard";
import AIModelSelector from "@/components/AIModelSelector";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims", "Requires Review", "Unclassified"];
const STEPS = ["Select Claim", "Upload Evidence", "AI Analysis", "Review & Edit", "Generate Report"];

const DUMMY_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const b64toBlob = (b64Data, contentType = "", sliceSize = 512) => {
  const byteCharacters = atob(b64Data);
  const byteArrays = [];
  for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    const slice = byteCharacters.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }
  return new Blob(byteArrays, { type: contentType });
};

const attachDummyEvidencePack = async (targetClaimId) => {
  const dummyDocs = [
    {
      name: "01_Marine_Cargo_Policy.txt",
      mime: "text/plain",
      category: "Policy",
      content: `OPEN CARGO & REEFER MARINE TRANSIT POLICY\nPolicy Number: M-CARGO-2023-4411\nInsurer: Orient Insurance PJSC, Dubai, UAE\nBroker: Marsh Middle East Ltd\nAssured / Insured: Al Futtaim Logistics LLC\nCommodity: Refrigerated Gala Apples in Standard 18kg Cartons\nLimit of Liability: USD 250,000.00 any one conveyance\nCoverage: Institute Cargo Clauses (A) / Institute Frozen Food Clauses (A)\nCarrying Temperature: +2°C to +4°C continuously\nDeductible / Excess: USD 500.00 each and every loss\nNotice Condition: Immediate notice required upon discharge.`
    },
    {
      name: "02_Commercial_Invoice_INV-9921.txt",
      mime: "text/plain",
      category: "Commercial Invoice",
      content: `COMMERCIAL INVOICE\nInvoice No: INV-9921 | Date: 01 November 2023\nShipper: USA Premium Apple Growers Inc., Yakima, WA, USA\nBuyer / Consignee: Al Futtaim Logistics LLC, Beirut / Dubai\nTerms: CIF Beirut Port (Incoterms 2020)\n----------------------------------------------------------------------\nItem | Description | Quantity | Unit Price (USD) | Total Amount (USD)\n1    | Fresh Gala Apples (18kg boxes) | 1,000 boxes | 45.00 | 45,000.00\n----------------------------------------------------------------------\nTotal Commercial FOB Value: USD 41,500.00\nFreight: USD 3,000.00 | Insurance: USD 500.00\nTotal Invoice CIF Value: USD 45,000.00`
    },
    {
      name: "03_Bill_of_Lading_MSCU99887766.txt",
      mime: "text/plain",
      category: "Bill of Lading",
      content: `OCEAN BILL OF LADING\nB/L No: MSCU99887766\nCarrier: Mediterranean Shipping Company (MSC)\nVessel: MSC ISABELLA v.234W\nPort of Loading: Port of New York, USA\nPort of Discharge: Beirut Port, Lebanon\nShipper: USA Premium Apple Growers Inc.\nConsignee: Al Futtaim Logistics LLC\nContainer No: MSCU1234567 | Seal No: MSC984210\nCargo: 1x40ft High Cube Reefer Container containing 1,000 Cartons of Fresh Apples\nSet Temperature: +3.0°C\nShipped on Board: 01 November 2023`
    },
    {
      name: "04_Survey_Inspection_Report.txt",
      mime: "text/plain",
      category: "Survey Report",
      content: `UNITED LOSS ADJUSTERS & SURVEYORS (ULA)\nOFFICIAL SURVEY & LOSS ADJUSTMENT REPORT\nDate of Attendance: 15 November 2023\nSurveyor: Petro Zaarour, Lead Marine Surveyor\nLocation: Beirut Port Cold Storage Facility\nSubject: Joint survey of container MSCU1234567 ex MSC ISABELLA\n\nINVESTIGATION & CAUSE OF LOSS:\n1. On de-vanning, temperature data logger TempTale-4 recorded an interruption of power for 48 hours during ocean transit, with internal pulp temperatures escalating to +16.8°C.\n2. Visual inspection revealed widespread fungal decay, soft rot, and internal browning.\n3. All 1,000 cartons were deemed commercially unmerchantable and a constructive total loss.\n\nADJUSTMENT & CONCLUDED QUANTUM:\n- Sound Value / Presented Claim: USD 45,000.00\n- Salvage Realized / Recovery: Nil (condemned by Health Authority)\n- Less Policy Deductible: (USD 500.00)\n- Concluded Payable Indemnity: USD 44,500.00`
    },
    {
      name: "05_Packing_List.txt",
      mime: "text/plain",
      category: "Packing List",
      content: `PACKING LIST\nReference: PL-9921 | Container: MSCU1234567\nPackage Count: 1,000 master cartons on 20 pallets\nNet Weight: 18,000.00 kg | Gross Weight: 19,400.00 kg\nPackaging: Corrugated ventilated export cartons with protective liners`
    }
  ];

  for (const doc of dummyDocs) {
    const file = new File([doc.content], doc.name, { type: doc.mime });
    const upload = await appClient.integrations.Core.UploadFile({ file });
    await appClient.entities.ClaimDocument.create({
      claim_id: targetClaimId,
      file_name: doc.name,
      file_mime_type: doc.mime,
      category: doc.category,
      ...upload
    });
  }

  for (let i = 1; i <= 3; i++) {
    const photoFile = new File([b64toBlob(DUMMY_IMAGE.split(",")[1], "image/jpeg")], `damage_photo_${i}.jpg`, { type: "image/jpeg" });
    const photoUpload = await appClient.integrations.Core.UploadFile({ file: photoFile });
    await appClient.entities.ClaimDocument.create({
      claim_id: targetClaimId,
      file_name: `damage_photo_${i}.jpg`,
      file_mime_type: "image/jpeg",
      category: "Photographs",
      ...photoUpload
    });
  }
};

export default function AIReporting() {
  const [step, setStep] = useState(0);
  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState(null);
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
  const [preflightStats, setPreflightStats] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [enableFallback, setEnableFallback] = useState(true);
  const [edited, setEdited] = useState({});
  const [generating, setGenerating] = useState(false);
  const [loadingDummy, setLoadingDummy] = useState(false);
  const [claimSearch, setClaimSearch] = useState("");
  const [claimFilter, setClaimFilter] = useState("all");
  const navigate = useNavigate();
  const readiness = useMemo(() => reportReadiness(edited || {}, documents), [edited, documents]);

  const filteredClaims = useMemo(() => {
    return claims.filter((item) => {
      const matchesSearch = !claimSearch.trim() || [
        item.title,
        item.claim_number,
        item.insured,
        item.business_line,
        item.commodity,
      ].some((val) => String(val || "").toLowerCase().includes(claimSearch.toLowerCase()));

      if (!matchesSearch) return false;

      if (claimFilter === "unclassified") {
        return item.business_line === "Unclassified" || !item.business_line;
      }
      if (claimFilter === "draft") {
        return item.status?.toLowerCase().includes("draft");
      }
      if (claimFilter === "in_progress") {
        return ["under investigation", "pending documents", "new"].includes(item.status?.toLowerCase());
      }
      return true;
    });
  }, [claims, claimSearch, claimFilter]);

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
    setStep(1);
  };

  const createDummyTestClaim = async () => {
    setLoadingDummy(true);
    try {
      const year = new Date().getFullYear();
      const number = `ULA-${year}-${String(claims.length + 1).padStart(4, "0")}`;
      const created = await appClient.entities.Claim.create({
        claim_number: number,
        title: "Test Claim - Refrigerated Gala Apples",
        business_line: "Marine Cargo (Reefer/GFS)",
        status: "New",
        priority: "High",
        insured: "Al Futtaim Logistics LLC",
        insurer: "Orient Insurance PJSC",
        broker: "Marsh Middle East Ltd",
        claim_amount: 45000.00,
        deductible: 500.00,
        cause_of_loss: "Temperature abuse during transit resulting in cargo spoilage.",
        policy_number: "M-CARGO-2023-4411",
        date_of_loss: "2023-11-14",
        vessel_name: "MSC ISABELLA",
        container_number: "MSCU1234567",
      });
      await attachDummyEvidencePack(created.id);
      await selectClaim(created.id);
      setClaims((current) => [created, ...current]);
      setStep(1);
      toast({ title: "Test claim created", description: "Created claim with complete policy, invoice, survey, and photo evidence." });
    } catch (err) {
      toast({ variant: "destructive", title: "Could not create test claim", description: err.message });
    } finally {
      setLoadingDummy(false);
    }
  };

  const loadSampleEvidence = async () => {
    if (!selectedClaimId) return;
    setLoadingDummy(true);
    try {
      await attachDummyEvidencePack(selectedClaimId);
      await reloadDocs();
      toast({ title: "Evidence pack loaded", description: "Sample policy, invoice, bill of lading, and damage photos attached." });
    } catch (err) {
      toast({ variant: "destructive", title: "Could not load evidence", description: err.message });
    } finally {
      setLoadingDummy(false);
    }
  };

  const reloadDocs = async () => {
    setDocuments(await appClient.entities.ClaimDocument.filter({ claim_id: selectedClaimId }));
  };

  const cancelAnalysis = () => {
    setAnalyzing(false);
    setAnalysisProgress({ active: false, progress: 0, stage: "" });
    setAnalysisError("Analysis was cancelled. You can pick another model and restart.");
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError("");
    setPreflightStats(null);
    setAnalysisProgress({ active: true, progress: 15, stage: "Ingesting evidence files & extracting text/OCR...", step: 1, totalSteps: 4 });

    const timer1 = setTimeout(() => {
      setAnalysisProgress((prev) => prev.active ? { active: true, progress: 40, stage: "Classifying documents & verifying policy clauses...", step: 2, totalSteps: 4 } : prev);
    }, 1800);
    const timer2 = setTimeout(() => {
      setAnalysisProgress((prev) => prev.active ? { active: true, progress: 70, stage: "Extracting salient claim facts & coverage terms...", step: 3, totalSteps: 4 } : prev);
    }, 4500);
    const timer3 = setTimeout(() => {
      setAnalysisProgress((prev) => prev.active ? { active: true, progress: 88, stage: "Synthesizing adjustment lines & recommendations...", step: 4, totalSteps: 4 } : prev);
    }, 9000);

    try {
      const response = await appClient.functions.invoke("analyseClaim", {
        claim_id: selectedClaimId,
        provider: selectedProvider,
        disable_fallback: selectedProvider === "anthropic" || !enableFallback,
        on_preflight: (stats) => {
          setPreflightStats(stats);
          setAnalysisProgress({ active: true, progress: 30, stage: "Preflight verified. Processing structured Claude analysis...", step: 1, totalSteps: 4 });
        },
      });
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setAnalysisProgress({ active: true, progress: 100, stage: "Analysis complete! Finalizing suggestions...", step: 4, totalSteps: 4 });
      await new Promise((r) => setTimeout(r, 300));
      setAnalysis(response.data.analysis);

      // Warning toast if fallback occurred
      const requestedProvider = selectedProvider;
      const actualProvider = response.data.analysis.provider;
      if (requestedProvider && actualProvider && requestedProvider.toLowerCase() !== actualProvider.toLowerCase()) {
        toast({
          title: "Automatic Provider Fallback",
          description: `The selected AI provider (${formatModelDisplayName(requestedProvider, null)}) was unavailable. The system completed the analysis using fallback provider ${formatModelDisplayName(actualProvider, response.data.analysis.model)}.`,
        });
      }

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
      navigate(`/claims/${selectedClaimId}?tab=report`);
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
        <div className="space-y-5">
          {/* Top Quick Actions */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="docket-surface relative flex flex-col justify-between border-primary/30 bg-primary/[0.03] p-5 shadow-xs transition-all hover:border-primary/50 hover:shadow-sm">
              <div>
                <div className="flex items-center gap-2 text-primary">
                  <Wand2 className="h-5 w-5" />
                  <span className="font-heading text-xs font-bold uppercase tracking-wider">Start Fresh</span>
                </div>
                <h3 className="mt-2 font-heading text-lg font-semibold text-foreground">Create New AI Claim</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Creates an empty claim docket and opens the evidence uploader. The AI will auto-detect the business line from your files.
                </p>
              </div>
              <div className="mt-4">
                <Button onClick={createClaim} className="ula-gradient text-white hover:opacity-90">
                  <Wand2 className="mr-2 h-4 w-4" /> Start New Claim
                </Button>
              </div>
            </Card>

            <Card className="docket-surface relative flex flex-col justify-between border-border bg-card p-5 shadow-xs transition-all hover:border-border/80 hover:shadow-sm">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <span className="font-heading text-xs font-bold uppercase tracking-wider">Instant Demo</span>
                </div>
                <h3 className="mt-2 font-heading text-lg font-semibold text-foreground">Test with Sample Pack</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generates a realistic Reefer Apples claim pre-attached with policy, invoice, survey notes, and inspection photos.
                </p>
              </div>
              <div className="mt-4">
                <Button variant="outline" onClick={createDummyTestClaim} disabled={loadingDummy}>
                  <Sparkles className="mr-2 h-4 w-4 text-primary" /> {loadingDummy ? "Generating..." : "Load Sample Claim"}
                </Button>
              </div>
            </Card>
          </div>

          {/* Existing Claims Selector Card */}
          <Card className="docket-surface overflow-hidden shadow-none border-border">
            <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-heading text-base font-semibold text-foreground">
                  Or select an existing claim <span className="font-mono text-xs font-normal text-muted-foreground">({filteredClaims.length})</span>
                </h3>
                <p className="text-xs text-muted-foreground">Select any registered docket to continue investigation or generate reports.</p>
              </div>

              {/* Search & Filter Inputs */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1 sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search claim, insured, line…"
                    value={claimSearch}
                    onChange={(e) => setClaimSearch(e.target.value)}
                    className="h-8 pl-8 pr-8 text-xs bg-background"
                  />
                  {claimSearch && (
                    <button
                      type="button"
                      onClick={() => setClaimSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
                  {[
                    ["all", "All"],
                    ["unclassified", "Unclassified"],
                    ["in_progress", "In Progress"],
                    ["draft", "Drafts"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setClaimFilter(key)}
                      className={`rounded px-2.5 py-1 text-[0.7rem] font-medium transition-colors ${
                        claimFilter === key
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Compact Claims List */}
            <div className="max-h-[340px] divide-y overflow-y-auto scrollbar-thin">
              {filteredClaims.length ? (
                filteredClaims.map((item) => {
                  const isSelected = selectedClaimId === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={async () => {
                        await selectClaim(item.id);
                        setStep(1);
                      }}
                      className={`group flex flex-col justify-between gap-3 p-3.5 sm:flex-row sm:items-center cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/5 border-l-2 border-l-primary"
                          : "hover:bg-muted/40 border-l-2 border-l-transparent"
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-foreground">{item.claim_number}</span>
                            <span className="font-medium text-sm text-foreground truncate max-w-[280px] sm:max-w-md">
                              {item.title}
                            </span>
                            {item.insured && (
                              <span className="text-xs text-muted-foreground">· {item.insured}</span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[0.72rem] text-muted-foreground flex-wrap">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                              {item.business_line || "Unclassified"}
                            </span>
                            <span>•</span>
                            <span>Status: <strong className="text-foreground">{item.status || "New"}</strong></span>
                            {item.date_of_loss && (
                              <>
                                <span>•</span>
                                <span>Loss: {item.date_of_loss}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          size="sm"
                          variant={isSelected ? "default" : "outline"}
                          className="h-7 text-xs font-medium"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await selectClaim(item.id);
                            setStep(1);
                          }}
                        >
                          Select & Upload <ArrowRight className="ml-1.5 h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  {claimSearch || claimFilter !== "all" ? (
                    <div>
                      <p>No claims match your search filters.</p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setClaimSearch("");
                          setClaimFilter("all");
                        }}
                        className="mt-1 h-auto p-0 text-xs text-primary"
                      >
                        Reset filters
                      </Button>
                    </div>
                  ) : (
                    <p>No claims registered yet. Click &quot;Start New Claim&quot; above to begin.</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4 mr-2" /> Change claim</Button>
              <Button variant="secondary" onClick={loadSampleEvidence} disabled={loadingDummy}>
                <Sparkles className="w-4 h-4 mr-2 text-primary" /> {loadingDummy ? "Attaching..." : "Attach Sample Evidence Pack"}
              </Button>
            </div>
            <Button onClick={() => setStep(2)} disabled={!documents.length}>Continue to AI Analysis <ArrowRight className="w-4 h-4 ml-2" /></Button>
          </div>
        </div>
      )}

      {step === 2 && claim && (
        <div>
          {analyzing ? (
            <AIAnalysisProgressCard progress={analysisProgress} provider={selectedProvider} preflight={preflightStats} onCancel={cancelAnalysis} className="mx-auto max-w-2xl" />
          ) : (
            <Card className="docket-surface p-8 text-center shadow-none">
              <FileText className="mx-auto mb-4 h-11 w-11 text-primary" />
              <h3 className="font-heading text-xl font-semibold">Ready to review {documents.length} source document(s)</h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">All registered evidence is submitted to the configured AI provider for content-based classification and extraction. Unsupported facts remain marked for confirmation.</p>
              {analysisError && <div className="mx-auto mt-4 max-w-xl rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left text-sm text-destructive" role="alert"><strong>AI analysis unavailable.</strong> {analysisError.replace(/^AI analysis unavailable\s*[—-]\s*/i, "")}</div>}
              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <AIModelSelector
                  value={selectedProvider}
                  onChange={setSelectedProvider}
                  enableFallback={enableFallback}
                  onEnableFallbackChange={setEnableFallback}
                  disabled={analyzing}
                />
                <Button onClick={runAnalysis} disabled={analyzing} className="ula-gradient text-white hover:opacity-90">Run AI Analysis</Button>
              </div>
              <div className="mt-6 flex justify-center"><Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-2" /> Back to upload</Button></div>
            </Card>
          )}
        </div>
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
