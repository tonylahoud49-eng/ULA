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
import { Brain, RefreshCw, Award, CheckCircle2, Zap, BookOpen, Trash2 } from "lucide-react";

export default function BrainKnowledgeModal({ triggerButton, open, onOpenChange }) {
  const [manifest, setManifest] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);

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

  const handlePurgeProfile = async (businessLine) => {
    if (!window.confirm(`Are you sure you want to purge all learned rules for "${businessLine}"? This action cannot be undone.`)) {
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
    <Dialog open={open} onOpenChange={(val) => {
      if (onOpenChange) onOpenChange(val);
      if (val) fetchBrainData();
    }}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Brain className="h-5 w-5 text-primary animate-pulse" />
              Loss Adjuster Brain · Autonomous Learning Hub
            </DialogTitle>
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

        <ScrollArea className="flex-1 pr-4 max-h-[50vh]">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1.5 mb-2">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                Learned Loss Adjuster Playbooks
              </h4>
              {profiles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  <Brain className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No loss adjuster playbooks generated yet. Upload an official final report to teach the Brain.
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
