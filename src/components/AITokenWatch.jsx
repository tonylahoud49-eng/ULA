import React from "react";
import { Coins, Zap, Sparkles, Clock, TrendingDown, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function AITokenWatch({
  mode = "post_run", // "pre_run" | "in_flight" | "post_run"
  usage = null,
  preflight = null,
  provider = "anthropic",
  model = "claude-sonnet-4-6",
  elapsedSeconds = 0,
  className = "",
}) {
  const normProvider = String(provider || "").toLowerCase();
  const normModel = String(model || "").toLowerCase();
  const isAnthropic = normProvider.includes("anthropic");
  const isFreeModel = usage?.is_free_tier
    || ["gemini", "groq", "ollama"].includes(normProvider)
    || normModel.endsWith(":free")
    || normModel.includes(":free/");
  const tierLabel = usage?.tier_label
    || (normProvider === "ollama" ? "Self-Hosted" : isFreeModel ? "Free Tier" : "Paid Tier");

  // Pre-run mode: show estimated tokens and cost
  if (mode === "pre_run" || (mode === "auto" && !usage && preflight)) {
    const estTokens = preflight?.estimated_input_tokens || preflight?.input_tokens || 0;
    const estCost = isFreeModel ? 0 : (preflight?.estimated_cost_usd || (estTokens ? (estTokens / 1_000_000 * 3.00) : 0));

    return (
      <div className={`rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-foreground transition-all ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary shrink-0 animate-pulse" />
            <span className="font-medium">Token Watch (Preflight):</span>
            <span className="font-mono font-semibold text-primary">
              ~{estTokens.toLocaleString()} input tokens
            </span>
            <span className="text-muted-foreground">
              {isFreeModel ? `(≈ $0.0000 USD · ${tierLabel})` : `(≈ $${estCost.toFixed(4)} USD)`}
            </span>
          </div>
          {isFreeModel ? (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-[10px] font-medium">
              <Sparkles className="h-3 w-3 text-emerald-500" />
              {tierLabel} ($0.00 / 1M)
            </Badge>
          ) : isAnthropic && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-[10px] font-medium">
              <Sparkles className="h-3 w-3 text-emerald-500" />
              Prompt Caching Active (-90%)
            </Badge>
          )}
        </div>
      </div>
    );
  }

  // In-flight mode: show live counter while analyzing
  if (mode === "in_flight") {
    return (
      <div className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground animate-in fade-in duration-200 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </div>
            <span className="font-semibold text-amber-800 dark:text-amber-300">Live Token Stream:</span>
            <span className="text-muted-foreground">Streaming AI analysis and structured findings...</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 text-amber-600" />
            <span>{elapsedSeconds}s elapsed</span>
            <span className="text-border">|</span>
            <span>Output budget: max 12k tokens</span>
          </div>
        </div>
      </div>
    );
  }

  // Post-run mode: show actual billed tokens and calculated cost
  if (!usage || (!usage.total_tokens && !usage.input_tokens && usage.estimated_cost_usd === undefined)) {
    return null;
  }

  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const totalTokens = usage.total_tokens || (inputTokens + outputTokens);
  const cost = Number(usage.estimated_cost_usd || 0);

  // Approximate savings if cache hits occurred or free model was used
  const cacheSavings = cacheRead > 0 ? (cacheRead / 1_000_000 * (3.00 - 0.30)) : 0;
  const estimatedSavings = usage.estimated_savings_usd !== undefined
    ? Number(usage.estimated_savings_usd)
    : cacheSavings;

  return (
    <div className={`rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm p-4 shadow-sm text-xs ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Coins className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-semibold text-sm leading-tight text-foreground flex items-center gap-1.5">
              Report Token Usage & Billing
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-pointer hover:text-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    {usage?.pricing_description || (
                      isFreeModel
                        ? `${tierLabel} model ($0.00 / 1M tokens)`
                        : "Calculated from official API rates per 1M tokens."
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Provider: <span className="font-medium text-foreground">{provider}</span> ({model})
            </p>
          </div>
        </div>

        {/* Cost Pill */}
        <div className="flex items-center gap-2">
          {estimatedSavings > 0.001 && (
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-[11px]">
              <TrendingDown className="h-3 w-3" />
              {isFreeModel ? `Saved ~$${estimatedSavings.toFixed(3)} vs Paid` : `Saved ~$${estimatedSavings.toFixed(3)} via Cache`}
            </Badge>
          )}
          <div className={`flex items-baseline gap-1.5 rounded-lg px-3 py-1.5 ${
            isFreeModel
              ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
              : "bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-300"
          }`}>
            <span className="text-[10px] uppercase font-bold tracking-wider opacity-80">
              {isFreeModel ? "Tier:" : "Billed:"}
            </span>
            <span className="font-mono text-sm font-bold">
              {isFreeModel ? "$0.0000" : `$${cost.toFixed(4)}`}
            </span>
            <span className="text-[10px] font-semibold opacity-90">
              {isFreeModel ? `USD (${tierLabel})` : "USD"}
            </span>
          </div>
        </div>
      </div>

      {/* Breakdown Grid */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
        <div className="rounded-lg bg-muted/40 p-2 border border-border/30">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Input Tokens</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">
            {inputTokens.toLocaleString()}
          </p>
        </div>

        <div className="rounded-lg bg-muted/40 p-2 border border-border/30">
          <p className="text-[10px] font-medium text-muted-foreground uppercase flex items-center justify-center gap-1">
            Cached (Read)
            {cacheRead > 0 && <span className="text-[9px] text-emerald-600 font-bold">90% off</span>}
          </p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">
            {cacheRead.toLocaleString()}
          </p>
        </div>

        <div className="rounded-lg bg-muted/40 p-2 border border-border/30">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Output Tokens</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">
            {outputTokens.toLocaleString()}
          </p>
        </div>

        <div className="rounded-lg bg-muted/40 p-2 border border-border/30">
          <p className="text-[10px] font-medium text-muted-foreground uppercase">Total Tokens</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-primary">
            {totalTokens.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
