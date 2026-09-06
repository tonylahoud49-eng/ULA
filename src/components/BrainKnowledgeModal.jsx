import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  RefreshCw,
  Award,
  CheckCircle2,
  Zap,
  BookOpen,
  Trash2,
  Sparkles,
  Upload,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  FileCheck2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function BrainKnowledgeModal({ triggerButton, open, onOpenChange }) {
  const [manifest, setManifest] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedBusinessLine, setSelectedBusinessLine] = useState("Marine Cargo (Reefer)");
  const [showHowItLearns, setShowHowItLearns] = useState(false);
  const [deletingReportId, setDeletingReportId] = useState(null);
  const { toast } = useToast();

  const handleRemoveReport = async (lr) => {
    const identifier = lr.fingerprint || lr.claim_id || lr.report_file_name;
    const name = lr.report_file_name || lr.claim_number || identifier;
    if (
      !window.confirm(
        `Are you sure you want to remove "${name}" from the Brain? Its learned knowledge and playbooks will be unlinked.`
      )
    ) {
      return;
    }
    setDeletingReportId(identifier);
    try {
      const res = await fetch(`/api/ai/brain/reports/${encodeURIComponent(identifier)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({
          title: "Report Removed from Brain",
          description: `Successfully removed "${name}".`,
        });
        await fetchBrainData();
      } else {
        throw new Error(data.error || "Failed to remove report.");
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Removal Failed",
        description: err.message || "Failed to remove report from Brain.",
      });
    } finally {
      setDeletingReportId(null);
    }
  };

  const fetchBrainData = async () => {
    setLoading(true);
    try {
      const [statusRes, profilesRes] = await Promise.all([
        fetch("/api/ai/brain/status"),
        fetch("/api/ai/brain/profiles"),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setManifest(data.manifest || null);
      }
      if (profilesRes.ok) {
        const pData = await profilesRes.json();
        setProfiles(pData.profiles || []);
      }
    } catch (error) {
      console.error("Failed to load brain knowledge:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSeedBenchmarks = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/ai/brain/seed-benchmarks", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast({
          title: "🧠 Approved ULA Benchmarks Loaded",
          description: `Successfully initialized ${data.seeded_count || 6} Director-approved playbooks across all business lines.`,
        });
        await fetchBrainData();
      } else {
        throw new Error(data.error || "Failed to seed benchmark playbooks.");
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Benchmark Seeding Failed",
        description: err.message || "Failed to load reference playbooks.",
      });
    } finally {
      setSeeding(false);
    }
  };

  const handleDirectUpload = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append(
        "claim",
        JSON.stringify({
          title: file.name.replace(/\.[^/.]+$/, ""),
          business_line: selectedBusinessLine,
        })
      );
      form.append("business_line", selectedBusinessLine);
      form.append("file_name", file.name);

      const res = await fetch("/api/ai/brain/learn-report", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to ingest report.");
      }

      toast({
        title: "🧠 Loss Adjuster Wisdom Learned",
        description: `Extracted ${data.learned_items?.cause_rules || 0} cause standards and ${data.learned_items?.quantum_rubrics || 0} quantum rubrics for ${data.business_line}.`,
      });
      await fetchBrainData();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Report Ingestion Failed",
        description: err.message || "Failed to analyze official report.",
      });
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const handlePurgeProfile = async (businessLine) => {
    if (
      !window.confirm(
        `Are you sure you want to purge all learned rules for "${businessLine}"? This action cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const safeKey = businessLine.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const res = await fetch(`/api/ai/brain/profiles/${safeKey}`, { method: "DELETE" });
      if (res.ok) {
        fetchBrainData();
      }
    } catch (err) {
      console.error("Failed to purge profile", err);
    }
  };

  useEffect(() => {
    if (open) {
      fetchBrainData();
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (onOpenChange) onOpenChange(val);
        if (val) fetchBrainData();
      }}
    >
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Brain className="h-5 w-5 text-primary animate-pulse" />
              Loss Adjuster Brain · Autonomous Learning Hub
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleSeedBenchmarks}
                disabled={seeding || loading}
                className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs"
                title="Seed 6 approved ULA Director reference playbooks"
              >
                <Sparkles className={`h-3.5 w-3.5 ${seeding ? "animate-spin" : ""}`} />
                {seeding ? "Seeding..." : "Seed ULA Benchmarks"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchBrainData}
                disabled={loading}
                className="h-8 gap-1 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
          <DialogDescription className="text-xs">
            Persistent loss adjuster intelligence distilled from certified official final reports. Adheres strictly to REPORT_SPEC.md non-leakage rules.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <p className="text-[0.65rem] font-medium text-muted-foreground uppercase">Learned Final Reports</p>
            <p className="font-heading text-2xl font-bold text-foreground mt-0.5">
              {manifest?.total_learned_reports ?? 0}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <p className="text-[0.65rem] font-medium text-muted-foreground uppercase">Active Business Profiles</p>
            <p className="font-heading text-2xl font-bold text-foreground mt-0.5">
              {profiles.length}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-center">
            <p className="text-[0.65rem] font-medium text-muted-foreground uppercase">Prompt Caching State</p>
            <p className="font-heading text-sm font-bold text-emerald-600 mt-1 flex items-center justify-center gap-1">
              <Zap className="h-4 w-4" /> 100% Cached Active
            </p>
          </div>
        </div>

        {/* Informational Accordion: When and How Does the Brain Learn */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
          <button
            type="button"
            onClick={() => setShowHowItLearns(!showHowItLearns)}
            className="w-full flex items-center justify-between text-xs font-semibold text-primary hover:opacity-80 transition-opacity"
          >
            <span className="flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-primary" />
              When and how does the Brain fill and learn?
            </span>
            {showHowItLearns ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showHowItLearns && (
            <div className="pt-2 text-xs text-muted-foreground space-y-2 border-t border-primary/10 mt-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded border bg-background p-2 space-y-1">
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <FileCheck2 className="h-3.5 w-3.5 text-emerald-600" />
                    1. On Report Upload
                  </p>
                  <p className="text-[0.72rem] leading-relaxed">
                    Uploading a certified final report to any claim docket triggers AI extraction of cause reasoning and quantum rubrics, scrubbing all private claim facts per <code>docs/REPORT_SPEC.md</code>.
                  </p>
                </div>
                <div className="rounded border bg-background p-2 space-y-1">
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    2. ULA Benchmarks
                  </p>
                  <p className="text-[0.72rem] leading-relaxed">
                    Click <strong>"Seed ULA Benchmarks"</strong> to instantly load the 6 Director-approved reference playbooks (Reefer, Cargo, Property, Bulk, Air, Land) with 0 API tokens.
                  </p>
                </div>
                <div className="rounded border bg-background p-2 space-y-1">
                  <p className="font-semibold text-foreground flex items-center gap-1">
                    <Upload className="h-3.5 w-3.5 text-blue-600" />
                    3. Direct In-Modal Upload
                  </p>
                  <p className="text-[0.72rem] leading-relaxed">
                    Upload any certified final report (PDF/DOCX) right here to teach the Brain for a specific business line without needing an active claim.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Direct In-Modal Upload Bar */}
        <div className="rounded-lg border bg-muted/30 p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <span className="font-semibold">Teach Brain Directly:</span>
            <select
              value={selectedBusinessLine}
              onChange={(e) => setSelectedBusinessLine(e.target.value)}
              className="text-xs border rounded px-2 py-1 bg-background text-foreground shadow-xs"
            >
              <option value="Marine Cargo (Reefer)">Marine Cargo (Reefer)</option>
              <option value="Marine Cargo (Non-Reefer)">Marine Cargo (Non-Reefer)</option>
              <option value="Property">Property & Fire</option>
              <option value="Bulk Vessels">Bulk Vessels</option>
              <option value="Air Cargo">Air Cargo</option>
              <option value="Land Transit">Land Transit</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              disabled={uploading}
              onChange={handleDirectUpload}
              className="text-xs text-muted-foreground file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
            />
            {uploading && (
              <span className="text-xs text-primary animate-pulse flex items-center gap-1 font-medium">
                <Brain className="h-3.5 w-3.5 animate-spin" /> Distilling...
              </span>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 pr-4 max-h-[44vh]">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5 mb-2">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                Learned Loss Adjuster Playbooks
              </h4>
              {profiles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground space-y-3">
                  <Brain className="h-8 w-8 mx-auto opacity-30 text-primary" />
                  <div>
                    <p className="font-semibold text-foreground">No loss adjuster playbooks generated yet</p>
                    <p className="mt-0.5">Initialize with ULA's 6 Director-approved benchmark playbooks or upload an official final report above.</p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSeedBenchmarks}
                    disabled={seeding || loading}
                    className="gap-1.5 text-xs bg-primary text-primary-foreground"
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${seeding ? "animate-spin" : ""}`} />
                    Seed 6 Director Benchmarks
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {profiles.map((p) => (
                    <div key={p.profile_id} className="rounded-lg border bg-card p-3.5 shadow-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Award className="h-4 w-4 text-emerald-600" />
                          <span className="font-heading text-sm font-semibold">{p.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="status-mark border-emerald-500 bg-emerald-50 text-emerald-800 text-[0.65rem]">
                            {p.ingested_count || 1} report(s) ingested
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            title="Purge learned profile"
                            onClick={() => handlePurgeProfile(p.applies_to?.business_lines?.[0] || p.title)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {p.style_notes && p.style_notes.length > 0 && (
                        <div className="space-y-1 pt-1 border-t">
                          {p.style_notes.map((note, idx) => (
                            <p key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="text-primary mt-0.5">•</span>
                              <span>{note}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {manifest?.learned_reports && manifest.learned_reports.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5 mb-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Ingestion History
                </h4>
                <div className="rounded-lg border overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-muted/50 border-b text-muted-foreground">
                      <tr>
                        <th className="p-2.5 font-medium">Claim</th>
                        <th className="p-2.5 font-medium">Business Line</th>
                        <th className="p-2.5 font-medium">Report File</th>
                        <th className="p-2.5 font-medium">Learned Via</th>
                        <th className="p-2.5 font-medium">Date</th>
                        <th className="p-2.5 font-medium text-right pr-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {manifest.learned_reports.map((lr, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-2.5 font-mono font-medium">{lr.claim_number || lr.claim_id?.slice(0, 8)}</td>
                          <td className="p-2.5">{lr.business_line}</td>
                          <td className="p-2.5 truncate max-w-[160px]" title={lr.report_file_name}>{lr.report_file_name}</td>
                          <td className="p-2.5 font-mono text-[0.7rem] text-muted-foreground">{lr.model}</td>
                          <td className="p-2.5 text-muted-foreground">{new Date(lr.learned_at).toLocaleDateString()}</td>
                          <td className="p-2.5 text-right pr-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive transition-colors"
                              title={`Remove ${lr.report_file_name || "report"} from Brain`}
                              disabled={deletingReportId === (lr.fingerprint || lr.claim_id || lr.report_file_name)}
                              onClick={() => handleRemoveReport(lr)}
                            >
                              <Trash2
                                className={`h-3.5 w-3.5 ${
                                  deletingReportId === (lr.fingerprint || lr.claim_id || lr.report_file_name)
                                    ? "animate-spin"
                                    : ""
                                }`}
                              />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
