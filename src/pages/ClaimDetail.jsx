import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Download, FileText, FileCheck2, Sparkles, AlertTriangle, Save, CheckCircle, ClipboardCheck, ShieldCheck, Trash2, UploadCloud, Award, Brain, Loader2 } from "lucide-react";
import DocumentUploader from "@/components/DocumentUploader";
import ReactMarkdown from "react-markdown";
import { toast } from "@/components/ui/use-toast";
import { REPORT_LIFECYCLE, reportReadiness } from "@/lib/reportTemplates";
import AIAnalysisProgressCard, { formatModelDisplayName } from "@/components/AIAnalysisProgressCard";
import AIModelSelector from "@/components/AIModelSelector";
import AITokenWatch from "@/components/AITokenWatch";
import BrainKnowledgeModal from "@/components/BrainKnowledgeModal";
import { MAX_REPORT_PHOTOGRAPHS, selectReportPhotographs } from "@/lib/reportPhotoSelection";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims", "Requires Review", "Unclassified"];
const STATUSES = ["New", "Under Investigation", "Pending Documents", "Report Draft", "Report Final", "Closed"];

const formatDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
};

const formatCurrencyAmount = (currency, value) => {
  if (value === undefined || value === null || value === "") return "Not established from reviewed evidence";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not established from reviewed evidence";
  const formatted = number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
};

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

const canvasBlob = (canvas, type = "image/jpeg", quality = 0.84) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The appendix page could not be rendered.")), type, quality);
});

const contentBands = (imageData, axis) => {
  const { data, width, height } = imageData;
  const length = axis === "x" ? width : height;
  const crossLength = axis === "x" ? height : width;
  const active = new Array(length).fill(false);
  const step = Math.max(1, Math.floor(crossLength / 420));
  const sampledCrossLength = Math.ceil(crossLength / step);

  for (let primary = 0; primary < length; primary += 1) {
    let contentPixels = 0;
    for (let cross = 0; cross < crossLength; cross += step) {
      const x = axis === "x" ? primary : cross;
      const y = axis === "x" ? cross : primary;
      const offset = (y * width + x) * 4;
      if (data[offset + 3] > 12 && (data[offset] < 238 || data[offset + 1] < 238 || data[offset + 2] < 238)) contentPixels += 1;
    }
    active[primary] = contentPixels / sampledCrossLength >= 0.09;
  }

  const bands = [];
  const mergeGap = Math.max(3, Math.round(length * 0.012));
  let start = -1;
  let lastActive = -1;
  for (let index = 0; index <= length; index += 1) {
    if (index < length && active[index]) {
      if (start < 0) start = index;
      lastActive = index;
      continue;
    }
    if (start >= 0 && (index - lastActive > mergeGap || index === length)) {
      bands.push([start, lastActive + 1]);
      start = -1;
      lastActive = -1;
    }
  }
  return bands.filter(([from, to]) => to - from >= length * 0.13);
};

const splitContactSheetCanvas = (source) => {
  const detectionScale = Math.min(1, 900 / source.width, 1_200 / source.height);
  const detector = globalThis.document.createElement("canvas");
  detector.width = Math.max(1, Math.round(source.width * detectionScale));
  detector.height = Math.max(1, Math.round(source.height * detectionScale));
  detector.getContext("2d").drawImage(source, 0, 0, detector.width, detector.height);
  const pixels = detector.getContext("2d").getImageData(0, 0, detector.width, detector.height);
  const columns = contentBands(pixels, "x");
  const rows = contentBands(pixels, "y");
  const photoCount = columns.length * rows.length;
  if (columns.length < 2 || columns.length > 3 || rows.length < 2 || rows.length > 3 || photoCount < 4 || photoCount > 9) {
    return [source];
  }

  return rows.flatMap(([top, bottom]) => columns.map(([left, right]) => {
    const x = Math.max(0, Math.round(left / detectionScale));
    const y = Math.max(0, Math.round(top / detectionScale));
    const width = Math.min(source.width - x, Math.round((right - left) / detectionScale));
    const height = Math.min(source.height - y, Math.round((bottom - top) / detectionScale));
    const frame = globalThis.document.createElement("canvas");
    frame.width = Math.max(1, width);
    frame.height = Math.max(1, height);
    frame.getContext("2d").drawImage(source, x, y, width, height, 0, 0, width, height);
    return frame;
  }));
};

const appendixImagesFromCanvas = async (canvas, metadata) => Promise.all(splitContactSheetCanvas(canvas).map(async (frame, index) => {
  const rendered = await canvasBlob(frame);
  return {
    ...metadata,
    data: new Uint8Array(await rendered.arrayBuffer()),
    content_type: "image/jpeg",
    extension: "jpg",
    width: frame.width,
    height: frame.height,
    contact_sheet_index: index,
  };
}));

const collectAppendixImages = async (documents, normalizedRecord) => {
  const appendixIds = new Set((normalizedRecord?.appendices || []).map((item) => item.document_id));
  const preferredPhotographs = normalizedRecord?.selected_photographs || [];
  const candidates = documents.filter((document) => appendixIds.has(document.id) && (
    document.detected_categories?.includes("Photographs")
    || document.file_type === "Photo"
    || document.category === "Photo Evidence"
    || /(?:photo|image|appendix)/i.test(document.file_name || "")
    || /^image\//i.test(document.file_mime_type || "")
  ));
  const images = [];
  for (const document of candidates) {
    try {
      const stored = await appClient.documentStorage.get(document.storage_key || document.file_url);
      const mimeType = String(document.file_mime_type || stored.mimeType || stored.blob.type || "").toLowerCase();
      if (mimeType.startsWith("image/")) {
        const bitmap = await globalThis.createImageBitmap(stored.blob);
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();
        images.push(...await appendixImagesFromCanvas(canvas, {
          document_id: document.id,
          document_name: document.file_name,
        }));
        continue;
      }
      if (mimeType === "application/pdf" || /\.pdf$/i.test(document.file_name || "")) {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist/legacy/build/pdf.mjs"),
          import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await stored.blob.arrayBuffer()), disableWorker: true });
        const pdf = await task.promise;
        const selectedPages = [...new Set(preferredPhotographs
          .filter((item) => item.document_id === document.id && Number.isInteger(item.page) && item.page > 0 && item.page <= pdf.numPages)
          .map((item) => item.page))];
        const pagesToRender = selectedPages.length
          ? selectedPages.slice(0, MAX_REPORT_PHOTOGRAPHS)
          : Array.from({ length: Math.min(pdf.numPages, MAX_REPORT_PHOTOGRAPHS) }, (_, index) => index + 1);
        for (const pageNumber of pagesToRender) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = globalThis.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          images.push(...await appendixImagesFromCanvas(canvas, {
            document_id: document.id,
            document_name: document.file_name,
            page: pageNumber,
          }));
          page.cleanup();
        }
        await pdf.destroy();
      }
    } catch (error) {
      console.warn(`Unable to embed appendix evidence ${document.file_name}: ${error.message}`);
    }
  }
  return selectReportPhotographs(images, preferredPhotographs);
};

const renderHighlightedOutput = (children) => {
  if (typeof children === "string") {
    if (/not established from reviewed evidence|requires confirmation|not testable from current evidence|insufficient substantive|not established across/i.test(children)) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
          {children}
        </span>
      );
    }
    if (/\[Conflict|human review required|withheld because/i.test(children)) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-900">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
          {children}
        </span>
      );
    }
  }
  return children;
};

const markdownComponents = {
  p: ({node, children, ...props}) => <p dir="auto" {...props}>{renderHighlightedOutput(children)}</p>,
  h1: ({node, ...props}) => <h1 dir="auto" {...props} />,
  h2: ({node, ...props}) => <h2 dir="auto" {...props} />,
  h3: ({node, ...props}) => <h3 dir="auto" {...props} />,
  h4: ({node, ...props}) => <h4 dir="auto" {...props} />,
  h5: ({node, ...props}) => <h5 dir="auto" {...props} />,
  h6: ({node, ...props}) => <h6 dir="auto" {...props} />,
  li: ({node, children, ...props}) => <li dir="auto" {...props}>{renderHighlightedOutput(children)}</li>,
  td: ({node, children, ...props}) => <td dir="auto" {...props}>{renderHighlightedOutput(children)}</td>,
  th: ({node, ...props}) => <th dir="auto" {...props} />
};

export default function ClaimDetail() {
  const { id } = useParams();
  const [claim, setClaim] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ active: false, progress: 0, stage: "", step: 1, totalSteps: 4 });
  const [preflightStats, setPreflightStats] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [enableFallback, setEnableFallback] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const readiness = useMemo(() => reportReadiness(claim || {}, documents), [claim, documents]);
  const currentProvider = selectedProvider.includes(":") ? selectedProvider.split(":")[0] : selectedProvider;
  const currentModel = selectedProvider.includes(":") ? selectedProvider.split(":").slice(1).join(":") : undefined;

  const load = async () => {
    try {
      const [c, docs, reps] = await Promise.all([
        appClient.entities.Claim.get(id),
        appClient.entities.ClaimDocument.filter({ claim_id: id }),
        appClient.entities.ReportVersion.filter({ claim_id: id }),
      ]);
      setClaim(c);
      setForm(c);
      setDocuments(docs);
      setReports(reps);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError("");
    setPreflightStats(null);
    const separator = selectedProvider.indexOf(":");
    const requestedProvider = separator >= 0 ? selectedProvider.slice(0, separator) : selectedProvider;
    const requestedModel = separator >= 0 ? selectedProvider.slice(separator + 1) : undefined;

    setAnalysisProgress({ active: true, progress: 15, stage: "Evidence Ingestion: Ingesting evidence files and parsing text...", step: 1, totalSteps: 4 });

    const timers = [];
    timers.push(setTimeout(() => {
      setAnalysisProgress((curr) => curr.active ? { ...curr, progress: 35, stage: "Document Classification: Classifying document types & confidence scoring...", step: 2 } : curr);
    }, 1500));
    timers.push(setTimeout(() => {
      setAnalysisProgress((curr) => curr.active ? { ...curr, progress: 65, stage: "Policy & Fact Extraction: Extracting salient facts & policy terms...", step: 3 } : curr);
    }, 4500));
    timers.push(setTimeout(() => {
      setAnalysisProgress((curr) => curr.active ? { ...curr, progress: 85, stage: "Docket Synthesis: Generating evidence findings & calculations...", step: 4 } : curr);
    }, 9000));

    try {
      const res = await appClient.functions.invoke("analyseClaim", {
        claim_id: id,
        provider: requestedProvider,
        model: requestedModel,
        disable_fallback: requestedProvider === "anthropic" || !enableFallback,
        on_preflight: (stats) => {
          setPreflightStats(stats);
          setAnalysisProgress((curr) => ({ ...curr, progress: 25, stage: "Preflight passed. Starting protected Claude analysis...", step: 1 }));
        },
      });
      timers.forEach(clearTimeout);
      setAnalysisProgress({ active: true, progress: 100, stage: "Analysis complete! Updating claim docket...", step: 4, totalSteps: 4 });
      await new Promise((r) => setTimeout(r, 300));
      setAnalysis(res.data.analysis);

      // Warning toast if fallback occurred
      const actualProvider = res.data.analysis.provider;
      if (requestedProvider && actualProvider && requestedProvider.toLowerCase() !== actualProvider.toLowerCase()) {
        toast({
          title: "Automatic Provider Fallback",
          description: `The selected AI provider (${formatModelDisplayName(requestedProvider, null)}) was unavailable. The system completed the analysis using fallback provider ${formatModelDisplayName(actualProvider, res.data.analysis.model)}.`,
        });
      }

      await load();
    } catch (e) {
      timers.forEach(clearTimeout);
      const message = e.response?.data?.error || e.message;
      setAnalysisError(message);
      toast({ variant: "destructive", title: "Analysis could not be completed", description: message });
    } finally {
      timers.forEach(clearTimeout);
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
            <p className="docket-subtitle">{claim.business_line} · {claim.insured || "Insured not yet established"} · {readiness.template.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AIModelSelector
            value={selectedProvider}
            onChange={setSelectedProvider}
            enableFallback={enableFallback}
            onEnableFallbackChange={setEnableFallback}
            disabled={analyzing}
          />
          <Button onClick={runAnalysis} disabled={analyzing || !documents.length} className="ula-gradient text-white hover:opacity-90">
            {analyzing ? (
              <>
                <span className="mr-2 h-2 w-2 rounded-full bg-white animate-pulse" /> Analyzing docket…
              </>
            ) : (
              "Run AI Analysis"
            )}
          </Button>
        </div>
      </div>

      {preflightStats && !analysisProgress.active && !analysis?.usage && (
        <AITokenWatch mode="pre_run" preflight={preflightStats} provider={currentProvider} model={currentModel} />
      )}

      {analysisProgress.active && (
        <div className="space-y-3">
          <AIAnalysisProgressCard progress={analysisProgress} provider={currentProvider} model={currentModel} preflight={preflightStats} />
          <AITokenWatch mode="in_flight" elapsedSeconds={analysisProgress.step * 3} provider={currentProvider} model={currentModel} />
        </div>
      )}

      {analysis?.usage && (
        <AITokenWatch
          mode="post_run"
          usage={analysis.usage}
          provider={analysis.provider || selectedProvider}
          model={analysis.model}
          className="mb-2"
        />
      )}

      <ReleaseChain claim={claim} documents={documents} reports={reports} readiness={readiness} />

      {analysis && (
        <section className="docket-surface overflow-hidden rounded-lg border border-border shadow-xs" aria-label="AI analysis summary">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckCircle className="h-3.5 w-3.5" />
              </span>
              <h4 className="font-heading text-xs font-semibold uppercase tracking-wider text-foreground">
                {analysis.confidence > 0 ? "AI Classification Recorded" : "AI Classification Requires Review"} · {analysis.confidence}% Confidence
              </h4>
            </div>
            {(analysis.provider || analysis.model) && (
              <div className="flex items-center gap-1.5 rounded border border-border/80 bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
                <span className="docket-label">Engine</span>
                <span className="font-mono text-[0.72rem] font-semibold text-foreground">
                  {formatModelDisplayName(analysis.provider, analysis.model)}
                </span>
              </div>
            )}
          </div>
          <div className="p-4 space-y-2">
            <p className="text-xs leading-relaxed text-foreground">{analysis.summary}</p>
            {analysis.missing_documents && analysis.missing_documents.length > 0 && (
              <div className="mt-2 flex items-start gap-2 rounded border border-amber-300 bg-amber-50/70 p-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span><strong>Action required:</strong> {analysis.missing_documents.join(", ")}</span>
              </div>
            )}
          </div>
        </section>
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
          <ReportSection claimId={id} claim={claim} documents={documents} reports={reports} onChanged={load} />
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
      <Field label="Employee visibility"><Select value={form.visibility || "private"} onValueChange={(v) => set("visibility", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private — creator and admins</SelectItem><SelectItem value="public">Public — all employees</SelectItem></SelectContent></Select></Field>
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
  const sections = useMemo(() => parseMarkdownSections(report?.content), [report?.content]);
  const entries = useMemo(() => Object.entries(sections).filter(([key]) => !["cover_page", "document_control", "version_history", "claim_salient_details"].includes(key)), [sections]);
  const initials = useMemo(() => String(data.insured_name || "ULA").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") || "ULA", [data.insured_name]);
  const value = (item) => item || "Not established from reviewed evidence";

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
              <div><dt>Date of loss</dt><dd>{formatDate(data.date_of_loss) || "Not established from reviewed evidence"}</dd></div>
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
                  {!report.assignments?.length && <tr><td colSpan="4">No responsibility assignments have been made.</td></tr>}
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
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{body || "No evidence-supported content was established for this section."}</ReactMarkdown>
              </section>
            ))}
          </div>

          <section className="report-closing-page" aria-label="ULA corporate information" style={{ background: "#ffffff", padding: "2.5rem 2.5rem", borderTop: "4px solid #7faea4" }}>
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <img src={ulaLogo} alt="United Loss Adjusters & Surveyors" style={{ width: "150px", height: "auto", margin: "0 auto" }} />
            </div>

            <div style={{ textAlign: "left", maxWidth: "34rem", margin: "0 auto 1.5rem", fontSize: "0.95rem", color: "#1f2937", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 0.6rem" }}>
                <strong style={{ color: "#111827", fontSize: "1.05rem" }}>Contact person</strong><br />
                <span style={{ textDecoration: "underline", color: "#111827" }}>Petro Zaarour</span><br />
                <span style={{ color: "#4b5563" }}>Director</span>
              </p>
              <p style={{ margin: "0 0 0.5rem" }}>
                <strong>United Kingdom:</strong> 71-75 Shelton Street, Covent Garden | London, England - WC2H 9JQ<br />
                <strong>Middle East:</strong> Mina Tower, Ain Warda Street | Beirut, Lebanon - WG2G+5CX
              </p>
              <p style={{ margin: "0 0 0.5rem" }}>
                <strong>Registered name:</strong> United Loss Adjusters and Surveyors Ltd.
              </p>
              <p style={{ margin: "0" }}>
                <strong>24/7 Contacts &amp; Claim Support:</strong> +44 (0) 20 3287 3326 | WhatsApp: +44 (0) 7 375 110 573<br />
                <strong>Office E:</strong> claims@unitedlossadjusters.com | <strong>W:</strong> https://www.unitedlossadjusters.com/
              </p>
            </div>

            <div style={{ textAlign: "center", margin: "1rem auto" }}>
              <img src={ulaJusticeStatue} alt="Lady Justice" style={{ width: "300px", height: "435px", objectFit: "cover", display: "block", margin: "0 auto" }} />
            </div>

            <p style={{ margin: "1.25rem auto 0", maxWidth: "34rem", fontSize: "0.75rem", color: "#6b7280", lineHeight: 1.55, textAlign: "justify", borderTop: "1px solid #e5e7eb", paddingTop: "0.75rem" }}>
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

function ReportSection({ claimId, claim, documents, reports, onChanged }) {
  const [generating, setGenerating] = useState(false);
  const [reportToApprove, setReportToApprove] = useState(null);
  const [approvingReportId, setApprovingReportId] = useState(null);
  const [activeReport, setActiveReport] = useState(null);
  const [exportReport, setExportReport] = useState(null);
  const [reportToDelete, setReportToDelete] = useState(null);
  const [deletingReportId, setDeletingReportId] = useState(null);
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
    const sanitizeTitle = (text, fallback) => {
      if (!text) return fallback || "Marine / Cargo Claim Assessment";
      const cleaned = String(text)
        .replace(/^[#\s*_-]+/, "")
        .replace(/\n[\s\S]*/, "")
        .replace(/#+\s*/g, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/[*_`~[\]()]/g, "")
        .replace(/ULA-\d+-\d+/g, "")
        .replace(/Version \d+/i, "")
        .replace(/Draft/i, "")
        .replace(/Cover Page\s*[-–:]*\s*/i, "")
        .replace(/Claim:\s*/i, "")
        .replace(/Business Line:\s*.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      return cleaned || fallback || "Marine / Cargo Claim Assessment";
    };

    const subjectClean = sanitizeTitle(claim?.cause_of_loss || claim?.title || report?.template_name, claim?.business_line ? `${claim.business_line} Claim` : "Survey & Claim Report");
    const applicantClean = insurerName ? (insurerName.startsWith("M/s.") ? insurerName : `M/s. ${insurerName}`) : "";
    const insuredClean = insuredName ? (insuredName.startsWith("M/s.") ? insuredName : `M/s. ${insuredName}`) : "";
    const headerTitle = [applicantClean, insuredClean, subjectClean].filter(Boolean).join(" – ") || "United Loss Adjusters & Surveyors Report";

    return {
      claim_number: report?.claim_number || claim?.claim_number || "",
      business_line: report?.business_line || claim?.business_line || "",
      insured_name: insuredName,
      insurer: insurerName,
      broker: brokerName,
      header_title: headerTitle,
      policy_number: report?.policy_number || claim?.policy_number || "",
      currency: report?.currency || claim?.currency || "",
      date_of_loss: report?.date_of_loss || claim?.date_of_loss || "",
      claimed_amount: report?.claimed_amount ?? claim?.claim_amount ?? "",
      adjusted_amount: report?.adjusted_amount ?? claim?.adjusted_amount ?? "",
      issue_date: formatDate(report?.approved_date || report?.created_date || new Date()),
      version_number: report?.version_number || "1",
      report_issue_state: report?.issue_state || report?.status || "Draft",
      legal_entity: "United Loss Adjusters & Surveyors",
      form_code: report?.template_name || "ULA Claim Report",
      investigator_name: report?.investigator_name || report?.assignments?.find((item) => item.role === "investigator")?.name || "Not assigned",
      investigator_designation: report?.investigator_designation || report?.assignments?.find((item) => item.role === "investigator")?.designation || "Not assigned",
      preparer_name: report?.preparer_name || report?.assignments?.find((item) => item.role === "preparer")?.name || "Not assigned",
      preparer_designation: report?.preparer_designation || report?.assignments?.find((item) => item.role === "preparer")?.designation || "Not assigned",
      reviewer_name: report?.reviewer_name || report?.assignments?.find((item) => item.role === "reviewer")?.name || "Not assigned",
      reviewer_designation: report?.reviewer_designation || report?.assignments?.find((item) => item.role === "reviewer")?.designation || "Not assigned",
      approver_name: report?.approver_name || report?.assignments?.find((item) => item.role === "approver")?.name || "Not assigned",
      approver_designation: report?.approver_designation || report?.assignments?.find((item) => item.role === "approver")?.designation || "Not assigned",
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
      const [{ populateMasterReportDocx }, response] = await Promise.all([
        import("@/lib/masterReportDocx"),
        fetch(masterReportTemplate),
      ]);
      if (!response.ok) throw new Error("The production report template could not be loaded.");
      setExportProgress({ active: true, format: "DOCX", progress: 35, stage: "Preparing active-claim appendix evidence..." });
      const appendixImages = await collectAppendixImages(documents, report.normalized_claim_record);
      setExportProgress({ active: true, format: "DOCX", progress: 60, stage: "Populating master paragraphs, tables, headers, footers, and appendices..." });
      const bytes = await populateMasterReportDocx(await response.arrayBuffer(), {
        report,
        claim,
        issueDate: getReportData(report).issue_date,
      }, { appendixImages });
      setExportProgress({ active: true, format: "DOCX", progress: 90, stage: "Packing the controlled ULA report..." });
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
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
      const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const data = getReportData(report);
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const width = pdf.internal.pageSize.getWidth();
      const height = pdf.internal.pageSize.getHeight();

      // Page 1: Cover Page (Framed with corporate header & skyscrapers)
      setExportProgress({ active: true, format: "PDF", progress: 20, stage: "Rendering framed cover page..." });
      if (!pdfCoverRef.current) throw new Error("Export cover element not found in DOM");
      const coverCanvas = await html2canvas(pdfCoverRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const coverImg = coverCanvas.toDataURL("image/jpeg", 0.90);
      pdf.addImage(coverImg, "JPEG", 0, 0, width, height);

      // Page 2: Control, Version History & Salient Details
      setExportProgress({ active: true, format: "PDF", progress: 40, stage: "Rendering document control & salient details..." });
      if (!pdfControlRef.current) throw new Error("Export control element not found in DOM");
      const controlCanvas = await html2canvas(pdfControlRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const controlImg = controlCanvas.toDataURL("image/jpeg", 0.90);
      pdf.addPage();
      pdf.addImage(controlImg, "JPEG", 0, 0, width, height);

      // Pages 3 to N-2: Discrete A4 Paginated Body Content (Zero Text Slicing)
      setExportProgress({ active: true, format: "PDF", progress: 60, stage: "Formatting discrete A4 report pages..." });
      if (!pdfBodyRef.current) throw new Error("Export body element not found in DOM");

      const buildPaginatedPages = (bodyElem) => {
        const a4Width = 794;
        const a4Height = 1123;
        const maxContentHeight = 980; // Leaves 48px top padding + 95px bottom clearance for footer

        const sections = Array.from(bodyElem.querySelectorAll(".report-content-section"));

        const container = document.createElement("div");
        container.style.position = "absolute";
        container.style.left = "-9999px";
        container.style.top = "0";
        container.style.width = `${a4Width}px`;
        document.body.appendChild(container);

        const createPage = () => {
          const page = document.createElement("div");
          page.className = "report-sheet";
          page.style.width = `${a4Width}px`;
          page.style.height = `${a4Height}px`;
          page.style.padding = "48px 56px 64px 56px";
          page.style.boxSizing = "border-box";
          page.style.background = "#ffffff";
          page.style.overflow = "hidden";
          page.style.fontFamily = "'Source Sans 3', Arial, sans-serif";

          const contentWrap = document.createElement("div");
          contentWrap.className = "report-main-content";
          contentWrap.style.padding = "0";
          contentWrap.style.width = "100%";
          page.appendChild(contentWrap);

          container.appendChild(page);
          return { page, contentWrap };
        };

        let activePage = createPage();

        for (const sec of sections) {
          const fullClone = sec.cloneNode(true);
          activePage.contentWrap.appendChild(fullClone);

          if (activePage.contentWrap.offsetHeight <= maxContentHeight) {
            continue;
          }

          activePage.contentWrap.removeChild(fullClone);

          const heading = sec.querySelector(".report-section-heading")?.cloneNode(true);
          const contentChildren = Array.from(sec.children).filter(
            (child) => !child.classList.contains("report-section-heading")
          );

          const units = [];
          if (heading) units.push({ node: heading, isHeading: true });

          for (const child of contentChildren) {
            if (child.tagName === "UL" || child.tagName === "OL") {
              const lis = Array.from(child.children);
              for (const li of lis) {
                const listWrap = document.createElement(child.tagName);
                listWrap.style.margin = "3px 0";
                listWrap.style.paddingLeft = "24px";
                listWrap.appendChild(li.cloneNode(true));
                units.push({ node: listWrap });
              }
            } else {
              units.push({ node: child.cloneNode(true) });
            }
          }

          let sectionWrap = document.createElement("section");
          sectionWrap.className = "report-content-section";
          sectionWrap.style.padding = "18px 0";
          sectionWrap.style.borderBottom = "1px solid #d8e1dc";
          activePage.contentWrap.appendChild(sectionWrap);

          for (let i = 0; i < units.length; i++) {
            const unit = units[i];
            sectionWrap.appendChild(unit.node);

            if (activePage.contentWrap.offsetHeight > maxContentHeight) {
              sectionWrap.removeChild(unit.node);

              if (!sectionWrap.children.length) {
                activePage.contentWrap.removeChild(sectionWrap);
              }

              activePage = createPage();

              sectionWrap = document.createElement("section");
              sectionWrap.className = "report-content-section";
              sectionWrap.style.padding = "18px 0";
              sectionWrap.style.borderBottom = "1px solid #d8e1dc";
              activePage.contentWrap.appendChild(sectionWrap);

              sectionWrap.appendChild(unit.node);
            }
          }
        }

        const pages = Array.from(container.children);
        return {
          pages,
          cleanup: () => {
            container.remove();
          },
        };
      };

      const { pages: bodyPages, cleanup: cleanupBodyPages } = buildPaginatedPages(pdfBodyRef.current);

      try {
        for (let i = 0; i < bodyPages.length; i++) {
          setExportProgress({
            active: true,
            format: "PDF",
            progress: 60 + Math.round(((i + 1) / bodyPages.length) * 20),
            stage: `Rendering body page ${i + 1} of ${bodyPages.length}...`,
          });
          const pageCanvas = await html2canvas(bodyPages[i], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
          const pageImg = pageCanvas.toDataURL("image/jpeg", 0.90);
          pdf.addPage();
          pdf.addImage(pageImg, "JPEG", 0, 0, width, height);
        }
      } finally {
        cleanupBodyPages();
      }

      // Page N-1: About ULA Page
      setExportProgress({ active: true, format: "PDF", progress: 85, stage: "Rendering About ULA corporate summary..." });
      if (pdfAboutRef.current) {
        const aboutCanvas = await html2canvas(pdfAboutRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
        const aboutImg = aboutCanvas.toDataURL("image/jpeg", 0.90);
        pdf.addPage();
        pdf.addImage(aboutImg, "JPEG", 0, 0, width, height);
      }

      // Final Page: Closing Page (Framed with Lady Justice statue & offices)
      setExportProgress({ active: true, format: "PDF", progress: 95, stage: "Rendering closing contacts & Lady Justice seal..." });
      if (!pdfClosingRef.current) throw new Error("Export closing element not found in DOM");
      const closingCanvas = await html2canvas(pdfClosingRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const closingImg = closingCanvas.toDataURL("image/jpeg", 0.90);
      pdf.addPage();
      pdf.addImage(closingImg, "JPEG", 0, 0, width, height);

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

  const officialFileInputRef = useRef(null);
  const [uploadingOfficial, setUploadingOfficial] = useState(false);
  const [learningBrainReportId, setLearningBrainReportId] = useState(null);

  const handleUploadOfficialReport = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setUploadingOfficial(true);
    try {
      const res = await appClient.functions.invoke("uploadOfficialFinalReport", {
        claim_id: claimId,
        file,
      });
      await onChanged();
      toast({
        title: "Official Final Report Uploaded",
        description: `Official certified report version has been added. Now ingesting into Loss Adjuster Brain...`,
      });
      if (res.data?.report) {
        handleLearnBrain(res.data.report, file);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: err.response?.data?.error || err.message,
      });
    } finally {
      setUploadingOfficial(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleLearnBrain = async (report, optionalFile) => {
    setLearningBrainReportId(report.id);
    try {
      const form = new FormData();
      if (optionalFile) {
        form.append("file", optionalFile);
      } else {
        const stored = await appClient.documentStorage.get(report.storage_key || report.file_url);
        if (stored?.blob) {
          form.append("file", stored.blob, report.file_name || "official_report.pdf");
        } else if (report.content) {
          form.append("report_text", report.content);
        }
      }
      form.append("claim", JSON.stringify(claim));
      form.append("file_name", report.file_name || "official_report.pdf");

      const response = await fetch("/api/ai/brain/learn-report", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Server returned ${response.status}`);
      }

      await appClient.entities.ReportVersion.update(report.id, {
        brain_learning_status: "learned",
        brain_learned_at: new Date().toISOString(),
      });
      await onChanged();

      toast({
        title: "🧠 Loss Adjuster Brain Ingested",
        description: `Learned ${data.learned_items?.cause_rules || 0} cause standards and ${data.learned_items?.quantum_rubrics || 0} quantum rubrics for ${data.business_line}.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Brain Learning Failed",
        description: err.message || "Failed to analyze official report.",
      });
    } finally {
      setLearningBrainReportId(null);
    }
  };

  const approve = async (r) => {
    try {
      const user = await appClient.auth.me();
      const updatedAssignments = (r.assignments || []).map((assignment) => {
        if (assignment.role === "approver") {
          return {
            ...assignment,
            name: user.full_name || user.email,
            designation: user.designation || "Loss Adjuster / Director",
            status: "Signed & Validated",
          };
        }
        return assignment;
      });

      await appClient.entities.ReportVersion.update(r.id, {
        status: "Final",
        issue_state: "Final",
        human_approval_required: false,
        approved_by: user.full_name || user.email,
        approved_date: new Date().toISOString(),
        assignments: updatedAssignments,
      });
      await appClient.entities.Claim.update(claimId, { status: "Report Final" });
      await onChanged();
      toast({
        title: "Report Approved & Finalized",
        description: `Controlled Version ${r.version_number} has been signed off and issued by ${user.full_name || user.email}.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Approval failed",
        description: e.message || "Failed to approve report version",
      });
    }
  };

  const deleteReportVersion = async () => {
    if (!reportToDelete || deletingReportId) return;

    const reportId = reportToDelete.id;
    const versionNumber = reportToDelete.version_number;
    setDeletingReportId(reportId);

    try {
      await appClient.entities.ReportVersion.delete(reportId);
      if (activeReport === reportId) setActiveReport(null);
      if (exportReport?.id === reportId) setExportReport(null);
      setReportToDelete(null);
      await onChanged();
      toast({
        title: "Report version deleted",
        description: `Version ${versionNumber} was deleted. The claim and other report versions were not changed.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Report version could not be deleted",
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setDeletingReportId(null);
    }
  };

  return (
    <Card className="docket-surface p-5 shadow-none">
      <div className="mb-5 flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-heading text-xl font-semibold">Controlled report versions</h3>
          <p className="mt-1 text-xs text-muted-foreground">Issued versions remain immutable; upload an official final report or generate an AI draft.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            ref={officialFileInputRef}
            className="hidden"
            accept=".docx,.pdf"
            onChange={handleUploadOfficialReport}
          />
          <BrainKnowledgeModal
            triggerButton={
              <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/10 shadow-xs">
                <Brain className="w-4 h-4 mr-2 text-primary" /> Loss Adjuster Brain
              </Button>
            }
          />
          <Button
            onClick={() => officialFileInputRef.current?.click()}
            disabled={uploadingOfficial}
            variant="outline"
            className="border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 shadow-xs"
          >
            {uploadingOfficial ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2 text-emerald-600" />}
            {uploadingOfficial ? "Uploading…" : "Upload Official Report"}
          </Button>
          <Button onClick={generate} disabled={generating} className="ula-gradient text-white hover:opacity-90">
            <Sparkles className="w-4 h-4 mr-2" /> {generating ? "Generating…" : "Generate Draft Report"}
          </Button>
        </div>
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
          <p className="text-sm">No report versions yet. Run AI analysis first, or upload an official final report.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.slice().reverse().map((r) => {
            const reportData = getReportData(r);
            const isFinal = r.issue_state === "Final" || r.status === "Final";
            return (
            <article key={r.id} className="docket-surface overflow-hidden rounded-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-heading text-lg font-semibold">Version {r.version_number}</h4>
                      {r.is_official_upload && (
                        <span className="status-mark border-emerald-500 bg-emerald-50 text-emerald-800 font-bold flex items-center gap-1 shadow-xs">
                          <Award className="h-3.5 w-3.5 text-emerald-600" /> Official Final Report
                        </span>
                      )}
                      <span className={`status-mark ${isFinal ? "border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold" : "border-primary/30 bg-primary/5 text-primary"}`}>
                        {r.issue_state || r.status || "Draft"}
                      </span>
                      {r.human_approval_required && !isFinal && (
                        <span className="status-mark border-amber-300 bg-amber-50 text-amber-800">
                          <ShieldCheck className="h-3 w-3" /> Human review required
                        </span>
                      )}
                      {isFinal && (
                        <span className="status-mark border-emerald-300 bg-emerald-50 text-emerald-800 flex items-center gap-1">
                          <CheckCircle className="h-3 w-3 text-emerald-600" /> {r.is_official_upload ? `Certified by ${r.approved_by || "Director"}` : `Signed off by ${r.approved_by || "Director"}`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{r.template_name} · {r.business_line || "Marine"} · {r.readiness?.overall_progress ?? (r.is_official_upload ? 100 : 0)}% completeness</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.is_official_upload && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-primary/40 text-primary hover:bg-primary/10 font-medium shadow-xs"
                      onClick={() => handleLearnBrain(r)}
                      disabled={learningBrainReportId === r.id}
                      title="Extract methodology and loss adjuster reasoning into the System Brain"
                    >
                      {learningBrainReportId === r.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Brain className="h-3.5 w-3.5 mr-1 text-primary" />}
                      {r.brain_learning_status === "learned" ? "Retrain Brain" : "Teach Brain"}
                    </Button>
                  )}
                  {!isFinal && !r.is_official_upload && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-xs"
                      onClick={() => approve(r)}
                    >
                      <FileCheck2 className="h-4 w-4 mr-1" />
                      Approve &amp; Sign Off
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setActiveReport(activeReport === r.id ? null : r.id)}>{activeReport === r.id ? "Hide preview" : "View preview"}</Button>
                  <Button variant="outline" size="sm" onClick={() => exportMarkdown(r)}><Download className="h-4 w-4 mr-1" /> MD</Button>
                  <Button variant="outline" size="sm" onClick={() => exportTxt(r)}><Download className="h-4 w-4 mr-1" /> TXT</Button>
                  <Button variant="outline" size="sm" onClick={() => exportDocx(r)}><Download className="h-4 w-4 mr-1" /> DOCX</Button>
                  <Button size="sm" onClick={() => exportPdf(r)} className="ula-gradient text-white hover:opacity-90"><Download className="h-4 w-4 mr-1" /> PDF</Button>
                  <Button variant="ghost" size="sm" onClick={() => setReportToDelete(r)} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid border-b bg-muted/20 sm:grid-cols-4">
                {(r.assignments || []).map((assignment) => (
                  <div key={assignment.role} className="border-b p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <p className="docket-label">{assignment.label}</p>
                    <p className="mt-1 truncate text-xs font-semibold">{assignment.name}</p>
                  </div>
                ))}
                {!r.assignments?.length && <div className="p-3 text-xs text-muted-foreground">Legacy version without recorded responsibility assignments.</div>}
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">Generated by {r.generated_by} · {new Date(r.created_date).toLocaleDateString()}</p>
              {activeReport === r.id && <ControlledReportPreview report={r} data={reportData} />}
            </article>
          );})}
        </div>
      )}

      <AlertDialog
        open={Boolean(reportToApprove)}
        onOpenChange={(open) => {
          if (!open && !approvingReportId) setReportToApprove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve report version {reportToApprove?.version_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This records you as the approver and issues this version as Final. Later corrections must be generated as a new report version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(approvingReportId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(approvingReportId)}
              onClick={(event) => {
                event.preventDefault();
                void approve(reportToApprove);
              }}
            >
              {approvingReportId ? "Approving…" : "Approve & issue final"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(reportToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingReportId) setReportToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete report version {reportToDelete?.version_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes only this report version. The claim and all other report versions will remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingReportId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(deletingReportId)}
              onClick={(event) => {
                event.preventDefault();
                void deleteReportVersion();
              }}
            >
              {deletingReportId ? "Deleting…" : "Delete version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                        <td>{renderHighlightedOutput(getReportData(exportReport).insurer || "Not established from reviewed evidence")}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Insured / Assured</td>
                        <td>{renderHighlightedOutput(getReportData(exportReport).insured_name || "Not established from reviewed evidence")}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Broker / Agent</td>
                        <td>{renderHighlightedOutput(getReportData(exportReport).broker || "Direct")}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Business Line</td>
                        <td>{renderHighlightedOutput(getReportData(exportReport).business_line || "Not established from reviewed evidence")}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Claimed Amount</td>
                        <td>{renderHighlightedOutput(formatCurrencyAmount(getReportData(exportReport).currency, getReportData(exportReport).claimed_amount))}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: "bold", background: "#f3f7f4" }}>Net Adjusted Amount</td>
                        <td>{renderHighlightedOutput(formatCurrencyAmount(getReportData(exportReport).currency, getReportData(exportReport).adjusted_amount))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>

          {/* Page 3: Flowing Body Content */}
          <div ref={pdfBodyRef} style={{ width: "794px", padding: "0 56px", boxSizing: "border-box", background: "white" }}>
            <div className="report-sheet" style={{ width: "100%", boxShadow: "none" }}>
              <div className="report-main-content" style={{ padding: 0 }}>
                {Object.entries(parseMarkdownSections(exportReport.content))
                  .filter(([key]) => {
                    const normalized = key.toLowerCase();
                    return (
                      !["cover_page", "document_control", "version_history", "claim_salient_details"].includes(normalized) &&
                      !normalized.includes("about_ula") &&
                      !normalized.includes("strategic_alliances") &&
                      !normalized.includes("corporate")
                    );
                  })
                  .map(([key, body], index) => (
                    <section className="report-content-section" key={key} style={{ padding: "22px 0", borderBottom: "1px solid #d8e1dc" }}>
                      <div className="report-section-heading">
                        <span>{String(index + 4).padStart(2, "0")}</span>
                        <h2>{key.replaceAll("_", " ")}</h2>
                      </div>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{body || "Assessment documented in claim file."}</ReactMarkdown>
                    </section>
                  ))}
              </div>
            </div>
          </div>

          {/* Page N-1: About ULA Corporate Summary Page */}
          <div ref={pdfAboutRef} style={{ width: "794px", height: "1123px", padding: "48px 56px 64px 56px", boxSizing: "border-box", background: "white", display: "flex", flexDirection: "column", justifyContent: "flex-start", fontFamily: "'Source Sans 3', Arial, sans-serif" }}>
            <div style={{ width: "100%", height: "4px", background: "#7faea4", marginBottom: "22px" }} />
            <h1 style={{ margin: "0 0 18px", color: "#111827", fontSize: "28px", fontWeight: 700 }}>About ULA</h1>
            <p style={{ fontSize: "12.5px", lineHeight: 1.65, color: "#1f2937", margin: "0 0 14px" }}>
              <strong>United Loss Adjusters and Surveyors (ULA)</strong> is a leading international provider of Adjusters, Surveyors, Solicitors and Consultants, offering unrivalled technical and legal solutions with exclusive access to the London Market's leading specialists.
            </p>
            <p style={{ fontSize: "12.5px", lineHeight: 1.65, color: "#1f2937", margin: "0 0 14px" }}>
              Founded in 2002, with strategic head offices in the Middle East and the United Kingdom, today ULA is the strategic ally of a world leading legal firm (with offices in over 60 major countries) and the correspondent for a number of global technical service providers (with offices in 140+ countries), with principals including but not limited to Insurers, Reinsurers, Brokers, P&amp;I clubs, Ship Owners, Shipyards and Agencies.
            </p>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "#1f8a79", margin: "16px 0 8px" }}>Lines of business:</p>
            <ul style={{ fontSize: "12px", lineHeight: 1.6, color: "#374151", margin: "0 0 14px", paddingLeft: "20px" }}>
              <li>Insurance &amp; Re-insurance</li>
              <li>Claims solutions and loss adjusting across all major lines: aviation, cargo, marine, property, fine arts and special risks claims</li>
              <li>Cargo &amp; Containers</li>
              <li>Marine &amp; Offshore</li>
              <li>Global Claim Recoveries &amp; Legal Support</li>
            </ul>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "#1f8a79", margin: "16px 0 8px" }}>Our team:</p>
            <p style={{ fontSize: "12px", lineHeight: 1.6, color: "#374151", margin: "0 0 14px" }}>
              Our team of qualified professionals experienced in the fields of Marine, Insurance, Finance, Engineering and Law known and respected for their integrity and credibility. Supported by a highly mobile team strategically positioned where our services are needed, we are always available on short notice to deal promptly with your queries. ULA is independent to the core and can be trusted to express unbiased views, and is not influenced by stakeholders.
            </p>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "#1f8a79", margin: "16px 0 8px" }}>ULA’s team members are recognised members of the following international institutions:</p>
            <ul style={{ fontSize: "11.5px", lineHeight: 1.6, color: "#374151", margin: "0", paddingLeft: "20px" }}>
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

          {/* Final Page: Corporate Closing Page — Framed with sage border on left/right/bottom (NO TOP BORDER), Lady Justice statue & offices */}
          <div ref={pdfClosingRef} style={{ width: "794px", height: "1123px", background: "#85b2a9", padding: "0 32px 32px 32px", boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", background: "#ffffff", padding: "40px 48px 24px 48px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", fontFamily: "'Source Sans 3', Arial, sans-serif" }}>
              <div>
                <div style={{ textAlign: "center", marginBottom: "14px" }}>
                  <img src={ulaLogo} alt="United Loss Adjusters & Surveyors" style={{ width: "155px", height: "auto", margin: "0 auto", display: "block" }} />
                </div>
                
                <div style={{ textAlign: "left", width: "100%", color: "#1f2937", lineHeight: 1.6 }}>
                  <p style={{ margin: "0 0 8px", fontSize: "13px" }}>
                    <strong style={{ color: "#111827", fontSize: "13.5px" }}>Contact person</strong><br />
                    <span style={{ textDecoration: "underline", color: "#111827" }}>Petro Zaarour</span><br />
                    <span style={{ color: "#4b5563" }}>Director</span>
                  </p>
                  <p style={{ margin: "0 0 6px", fontSize: "12px", lineHeight: 1.55 }}>
                    <strong>United Kingdom:</strong> 71-75 Shelton Street, Covent Garden | London, England - WC2H 9JQ<br />
                    <strong>Middle East:</strong> Mina Tower, Ain Warda Street | Beirut, Lebanon - WG2G+5CX
                  </p>
                  <p style={{ margin: "0 0 6px", fontSize: "12px" }}>
                    <strong>Registered name:</strong> United Loss Adjusters and Surveyors Ltd.
                  </p>
                  <p style={{ margin: "0", fontSize: "12px", lineHeight: 1.55 }}>
                    <strong>24/7 Contacts &amp; Claim Support</strong> – T: +44 (0) 20 3287 3326 | M/WhatsApp: +44 (0) 7 375 110 573<br />
                    <strong>Office E:</strong> <a href="mailto:claims@unitedlossadjusters.com" style={{ color: "#1f8a79", textDecoration: "underline" }}>claims@unitedlossadjusters.com</a><br />
                    <strong>W:</strong> <a href="https://www.unitedlossadjusters.com/" style={{ color: "#1f8a79", textDecoration: "underline" }}>https://www.unitedlossadjusters.com/</a>
                  </p>
                </div>
              </div>

              {/* Authentic Lady Justice Statue Sized to Fill Whitespace */}
              <div style={{ textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", margin: "4px auto 8px" }}>
                <img src={ulaJusticeStatue} alt="Lady Justice" style={{ width: "320px", height: "465px", objectFit: "contain", display: "block" }} />
              </div>

              {/* Complete Legal & Regulatory Disclaimers */}
              <div style={{ textAlign: "justify", width: "100%", fontSize: "8.5px", color: "#4b5563", lineHeight: 1.55, borderTop: "1.5px solid #d1d5db", paddingTop: "8px" }}>
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
