import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, Sparkles, RotateCw, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function AutonomousAgentStepper({ claim, onReportGenerated, className = "" }) {
  const [running, setRunning] = useState(false);
  const [activePhase, setActivePhase] = useState(null);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState("hybrid"); // "hybrid" | "free" | "forensic"

  const PHASES = [
    { id: "perception_indexing", label: "1. Indexing (Flash)", desc: "Dossier Cache & OCR" },
    { id: "reconciliation_triage", label: "2. Reconciliation", desc: "Tallies & Discrepancies" },
    { id: "coverage_cause_audit", label: "3. Adjuster Audit", desc: "Cause & Coverage" },
    { id: "quantum_calculation", label: "4. Quantum ($0)", desc: "Deterministic Math" },
    { id: "report_assembly", label: "5. Assembly", desc: "Director Quality Gate" },
  ];

  const handleRunAgent = async () => {
    if (!claim?.id) return;
    setRunning(true);
    setProgress(15);
    setActivePhase("perception_indexing");

    try {
      const res = await fetch(`/api/agent/claims/${claim.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim, mode }),
      });

      if (!res.ok) {
        throw new Error(`Agent run failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      setProgress(100);
      setActivePhase("complete");
      toast({
        title: "Autonomous Investigation Complete",
        description: `Generated certified report via ${mode.toUpperCase()} pipeline with zero arithmetic hallucination.`,
      });

      if (onReportGenerated && data.report) {
        onReportGenerated(data.report);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Agent Execution Interrupted",
        description: err.message || "Failed to execute agent pipeline.",
      });
    } finally {
      setRunning(false);
    }
  };

  const handleClearCache = async () => {
    if (!claim?.id) return;
    try {
      await fetch(`/api/agent/claims/${claim.id}/dossier`, { method: "DELETE" });
      toast({ title: "Dossier Cache Cleared", description: "Next agent run will perform full perceptual indexing." });
    } catch {
      toast({ variant: "destructive", title: "Could not clear dossier cache." });
    }
  };

  return (
    <div className={`rounded-xl border border-primary/20 bg-card p-5 shadow-xs space-y-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-sm font-semibold tracking-wide">Autonomous Loss Adjuster Agent</h3>
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider border-primary/30 text-primary">
                v2.0 Parallel
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">Self-correcting 5-phase investigation with zero token waste</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={running}
            className="text-xs border border-border rounded-md px-2.5 py-1.5 bg-background font-medium focus:ring-1 focus:ring-primary"
            aria-label="Agent Execution Mode"
          >
            <option value="hybrid">⚡ Hybrid Balanced (Gemini 2.0 Flash + Sonnet 3.7)</option>
            <option value="free">🌿 Max Savings (100% Free Gemini Flash Tier)</option>
            <option value="forensic">🔬 Ultra Forensic (Pure Claude Sonnet)</option>
          </select>

          <Button
            onClick={handleClearCache}
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Clear cached dossier"
            disabled={running}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button onClick={handleRunAgent} disabled={running} className="gap-1.5 h-8 text-xs font-medium ula-gradient text-white">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? "Agent Investigating…" : "Run Autonomous Agent"}
          </Button>
        </div>
      </div>

      {running && (
        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <RotateCw className="h-3.5 w-3.5 animate-spin text-primary" /> Autonomous Execution in Progress
            </span>
            <span className="font-mono">{progress}%</span>
          </div>

          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1 text-[0.7rem]">
            {PHASES.map((p) => {
              const active = activePhase === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-2 rounded-md border transition-all ${
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary shadow-xs"
                      : "border-border/60 bg-muted/20 text-muted-foreground"
                  }`}
                >
                  <div className="truncate">{p.label}</div>
                  <div className="text-[10px] opacity-75 truncate">{p.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
