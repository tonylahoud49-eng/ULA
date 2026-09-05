import React, { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

export function formatModelDisplayName(provider, model) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();

  if (p === "anthropic" || m.includes("claude") || m.includes("sonnet")) {
    return `Anthropic · ${model || "Claude"}`;
  }
  if (p === "gemini" || m.includes("gemini")) {
    if (m.includes("2.5-flash") || m.includes("2.5")) return "Gemini 2.5 Flash";
    if (m.includes("1.5-pro") || m.includes("pro")) return "Gemini 1.5 Pro";
    return `Gemini (${model || "Flash"})`;
  }
  if (p === "openai" || m.includes("gpt")) {
    if (m.includes("5.6-terra") || m.includes("5.6")) return "GPT-5.6 Terra";
    if (m.includes("4o-mini")) return "GPT-4o Mini";
    if (m.includes("4o")) return "GPT-4o";
    return `OpenAI (${model || "GPT-4o"})`;
  }
  if (p === "openrouter") {
    const clean = String(model || "").split("/").pop() || model || "Gemma 4";
    return `OpenRouter · ${clean}`;
  }
  return provider && model ? `${provider} / ${model}` : "Claude 3.5 Sonnet";
}

const STAGES = [
  { step: 1, name: "Evidence Ingestion", detail: "OCR & vision parsing" },
  { step: 2, name: "Document Classification", detail: "Category & confidence" },
  { step: 3, name: "Policy & Fact Extraction", detail: "Coverage & salient terms" },
  { step: 4, name: "Docket Synthesis", detail: "Quantum & report draft" },
];

const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function AIAnalysisProgressCard({ progress, provider, model, preflight, className = "" }) {
  const [aiStatus, setAiStatus] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    let interval;
    if (progress?.active) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [progress?.active]);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setAiStatus(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const selectedProviderStatus = provider
    ? aiStatus?.configured_providers?.find((item) => item.provider === provider)
    : null;
  const activeProvider = provider || aiStatus?.provider;
  const activeModel = model
    || selectedProviderStatus?.model
    || (activeProvider === aiStatus?.provider ? aiStatus?.model : null);
  const modelLabel = formatModelDisplayName(activeProvider, activeModel);
  const currentStep = progress?.step || 1;
  const percentage = Math.min(100, Math.max(0, progress?.progress || 0));

  return (
    <section
      className={`docket-surface overflow-hidden rounded-lg border border-border shadow-xs ${className}`}
      aria-label="AI evidence analysis progress"
    >
      {/* Top Header: Identity, Engine Provenance & Percentage */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-5 py-3.5">
        <div className="flex items-center gap-3">
          {/* Quiet, institutional activity pip */}
          <span className="relative flex h-3 w-3 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-semibold uppercase tracking-wider text-foreground">
              AI Analysis Docket in Progress
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded border border-border/80 bg-background px-2.5 py-1 text-xs text-muted-foreground">
            <span className="docket-label">Engine</span>
            <span className="font-mono text-[0.72rem] font-semibold text-foreground">{modelLabel}</span>
          </div>
          <span className="font-mono text-sm font-bold text-primary">{percentage}%</span>
        </div>
      </div>

      {preflight && (
        <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3" aria-label="Anthropic preflight summary">
          {[
            ["Documents", preflight.document_count],
            ["Extracted text", formatBytes(preflight.extracted_text_bytes)],
            ["Sent text", formatBytes(preflight.sent_text_characters)],
            ["Visual inputs", preflight.sent_visual_count || 0],
            ["Estimated input", `${Number(preflight.estimated_input_tokens || 0).toLocaleString()} tokens`],
            ["Estimated cost", `$${Number(preflight.estimated_cost_usd || (Number(preflight.estimated_input_tokens || 0) / 1_000_000 * 3.00)).toFixed(4)} USD`],
            ["Request size", formatBytes(preflight.estimated_request_bytes)],
            ["Provider", preflight.selected_provider],
            ["Model", preflight.selected_model],
          ].map(([label, value]) => (
            <div key={label} className="bg-background px-3 py-2">
              <div className="docket-label text-[0.6rem] text-muted-foreground">{label}</div>
              <div className="mt-0.5 truncate font-mono text-[0.7rem] font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Contiguous Ruled 4-Stage Workflow Ledger */}
      <div className="grid sm:grid-cols-4 border-b bg-card">
        {STAGES.map((s) => {
          const isDone = s.step < currentStep;
          const isCurrent = s.step === currentStep;
          return (
            <div
              key={s.step}
              className={`relative border-b p-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 transition-colors ${
                isCurrent ? "bg-primary/[0.04]" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold ${
                    isDone
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCurrent
                      ? "border-primary text-primary animate-pulse"
                      : "border-border text-muted-foreground/70"
                  }`}
                >
                  {isDone ? <CheckCircle2 className="h-3 w-3" /> : s.step}
                </span>
                <span
                  className={`truncate text-xs font-semibold ${
                    isDone || isCurrent ? "text-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {s.name}
                </span>
              </div>
              <p className="mt-1.5 pl-7 text-[0.68rem] text-muted-foreground leading-tight">
                {isDone ? "Completed" : isCurrent ? s.detail : "Queued"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Real-time Stage Status Strip & Precision Hairline Track */}
      <div className="bg-muted/15 px-5 py-3">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="truncate font-medium text-foreground text-[0.78rem]">
            {progress?.stage || "Processing claim evidence..."}
          </span>
          <div className="flex items-center gap-2 font-mono text-[0.7rem] text-muted-foreground shrink-0 ml-3">
            {elapsedSeconds > 0 && (
              <span className="text-primary font-semibold flex items-center gap-1">
                <span>⏱️</span>
                <span>{elapsedSeconds}s</span>
              </span>
            )}
            <span>Step {currentStep} of {progress?.totalSteps || 4}</span>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </section>
  );
}

