import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, Sparkles, RotateCw, Trash2, CheckCircle2, ChevronDown, ChevronUp, Terminal, Clock } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function AutonomousAgentStepper({ claim, onReportGenerated, className = "" }) {
  const [running, setRunning] = useState(false);
  const [activePhase, setActivePhase] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [activityLogs, setActivityLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mode, setMode] = useState("hybrid"); // "hybrid" | "free" | "forensic"
  const logsEndRef = useRef(null);

  const PHASES = [
    { id: "perception_indexing", label: "1. Indexing (Flash)", desc: "Dossier Cache & OCR" },
    { id: "reconciliation_triage", label: "2. Reconciliation", desc: "Tallies & Discrepancies" },
    { id: "coverage_cause_audit", label: "3. Adjuster Audit", desc: "Cause & Coverage" },
    { id: "quantum_calculation", label: "4. Quantum ($0)", desc: "Deterministic Math" },
    { id: "report_assembly", label: "5. Assembly", desc: "Director Quality Gate" },
  ];

  // Auto-scroll logs as new entries arrive
  useEffect(() => {
    if (logsEndRef.current && showLogs) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activityLogs, showLogs]);

  // Elapsed timer ticker during active run
  useEffect(() => {
    let interval = null;
    if (running) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [running]);

  const addLog = (text, phase = null) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setActivityLogs((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time, text, phase },
    ]);
  };

  const handleRunAgent = async () => {
    if (!claim?.id) return;
    setRunning(true);
    setProgress(5);
    setElapsedSeconds(0);
    setActivePhase("perception_indexing");
    setStatusMessage("Connecting to autonomous loss adjuster orchestrator...");
    setActivityLogs([]);

    const modeLabels = {
      hybrid: "⚡ Hybrid Balanced (Gemini 3.7 Flash + Sonnet 3.7)",
      free: "🌿 Max Savings (100% Free Gemini Flash Tier)",
      forensic: "🔬 Ultra Forensic (Pure Claude Sonnet)",
    };

    addLog(`Pipeline initialized in ${modeLabels[mode] || mode}`);
    addLog(`Target Claim: ${claim.claim_number || claim.title || claim.id}`);

    try {
      const res = await fetch(`/api/agent/claims/${claim.id}/run?stream=true`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({ claim, mode, stream: true }),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const contentType = res.headers.get("content-type") || "";

      // Handle real-time Server-Sent Events stream
      if (contentType.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let finalReport = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const block of lines) {
            const trimmed = block.trim();
            if (!trimmed.startsWith("data:")) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            let event = null;
            try {
              event = JSON.parse(jsonStr);
            } catch (parseErr) {
              console.warn("Could not parse agent stream event:", parseErr);
              continue;
            }

            if (event.type === "progress") {
              if (event.progress !== undefined) setProgress(event.progress);
              if (event.name) setActivePhase(event.name);
              if (event.description) {
                setStatusMessage(event.description);
                addLog(event.description, event.name);
              }
            } else if (event.type === "complete") {
              finalReport = event.report;
              setProgress(100);
              setActivePhase("complete");
              setStatusMessage("✓ Autonomous investigation certified and complete.");
              addLog("Master investigation report assembled and passed Director quality gates.");
            } else if (event.type === "error") {
              throw new Error(event.error || "Agent execution encountered an error.");
            }
          }
        }

        if (finalReport) {
          toast({
            title: "Autonomous Investigation Complete",
            description: `Generated certified report via ${mode.toUpperCase()} pipeline with zero arithmetic hallucination.`,
          });
          if (onReportGenerated) {
            onReportGenerated(finalReport);
          }
        } else {
          throw new Error("Agent pipeline ended without generating a certified report.");
        }
      } else {
        // Fallback for standard non-streaming response
        const data = await res.json();
        setProgress(100);
        setActivePhase("complete");
        setStatusMessage("✓ Investigation completed successfully.");
        addLog("Report successfully generated via fallback endpoint.");
        toast({
          title: "Autonomous Investigation Complete",
          description: `Generated certified report via ${mode.toUpperCase()} pipeline.`,
        });
        if (onReportGenerated && data.report) {
          onReportGenerated(data.report);
        }
      }
    } catch (err) {
      addLog(`❌ Error: ${err.message || "Failed to execute agent pipeline."}`);
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
      addLog("Intermediate dossier cache cleared for this claim.");
      toast({ title: "Dossier Cache Cleared", description: "Next agent run will perform full perceptual indexing." });
    } catch {
      toast({ variant: "destructive", title: "Could not clear dossier cache." });
    }
  };

  const formatElapsed = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <div className={`rounded-xl border border-primary/20 bg-card p-5 shadow-xs space-y-4 ${className}`}>
      {/* Header controls */}
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
            <option value="hybrid">⚡ Hybrid Balanced (Gemini 3.7 Flash + Sonnet 3.7)</option>
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

      {/* Progress bar and live status */}
      {(running || activityLogs.length > 0) && (
        <div className="space-y-3 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              {running ? (
                <>
                  <RotateCw className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>Autonomous Execution in Progress</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Investigation Ready</span>
                </>
              )}
            </span>
            <div className="flex items-center gap-3 font-mono">
              {running && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> {formatElapsed(elapsedSeconds)}
                </span>
              )}
              <span className="font-semibold text-foreground">{progress}%</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Active Live Status Description */}
          {statusMessage && (
            <div className="flex items-center justify-between gap-2 px-1 text-xs">
              <span className="text-muted-foreground truncate italic">
                {statusMessage}
              </span>
              <button
                type="button"
                onClick={() => setShowLogs(!showLogs)}
                className="text-[11px] text-primary hover:underline flex items-center gap-0.5 shrink-0"
              >
                <Terminal className="h-3 w-3" />
                {showLogs ? "Hide Details" : "Show Details"}
                {showLogs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          )}

          {/* 5 Phase Pills */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1 text-[0.7rem]">
            {PHASES.map((p) => {
              const active = activePhase === p.id;
              const isPast = progress > 0 && !active && (
                (p.id === "perception_indexing" && progress >= 40) ||
                (p.id === "reconciliation_triage" && progress >= 60) ||
                (p.id === "coverage_cause_audit" && progress >= 80) ||
                (p.id === "quantum_calculation" && progress >= 95) ||
                (p.id === "report_assembly" && progress >= 100)
              );

              return (
                <div
                  key={p.id}
                  className={`p-2 rounded-md border transition-all ${
                    active
                      ? "border-primary bg-primary/10 font-semibold text-primary shadow-xs ring-1 ring-primary/20"
                      : isPast
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 font-medium"
                        : "border-border/60 bg-muted/20 text-muted-foreground"
                  }`}
                >
                  <div className="truncate flex items-center justify-between">
                    <span>{p.label}</span>
                    {isPast && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />}
                  </div>
                  <div className="text-[10px] opacity-75 truncate">{p.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Live Activity Feed / Thought Stream */}
          {showLogs && activityLogs.length > 0 && (
            <div className="mt-2 rounded-lg border border-border/80 bg-muted/40 p-3 text-xs font-mono max-h-40 overflow-y-auto space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pb-1 border-b border-border/40 mb-1">
                <span className="flex items-center gap-1 uppercase tracking-wider font-semibold">
                  <Terminal className="h-3 w-3 text-primary" /> Live Agent Activity Feed
                </span>
                <span>{activityLogs.length} events</span>
              </div>
              {activityLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 leading-tight text-foreground/90">
                  <span className="text-muted-foreground shrink-0 text-[10px]">{log.time}</span>
                  <span className="break-all">{log.text}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
