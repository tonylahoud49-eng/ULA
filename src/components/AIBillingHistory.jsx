import React, { useEffect, useMemo, useState } from "react";
import {
  Coins,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  Layers,
  Database,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formatTime = (value) => {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

export default function AIBillingHistory({ onSelectClaim = null, className = "" }) {
  const [data, setData] = useState({
    summary: {
      total_runs_count: 0,
      free_tier_runs_count: 0,
      paid_tier_runs_count: 0,
      total_cost_usd: 0,
      total_savings_usd: 0,
      total_tokens: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cache_read_tokens: 0,
    },
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");

  const loadBillingHistory = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/billing-history");
      if (!res.ok) {
        throw new Error(`Failed to load AI billing history (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || "Failed to load billing history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBillingHistory();
  }, []);

  const providers = useMemo(() => {
    const set = new Set((data.items || []).map((i) => i.provider).filter(Boolean));
    return ["all", ...Array.from(set).sort()];
  }, [data.items]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data.items || []).filter((item) => {
      // Provider filter
      if (providerFilter !== "all" && item.provider !== providerFilter) {
        return false;
      }
      // Tier filter
      const isFree = item.usage?.is_free_tier === true || Number(item.usage?.estimated_cost_usd || 0) === 0;
      if (tierFilter === "free" && !isFree) return false;
      if (tierFilter === "paid" && isFree) return false;

      // Text search
      if (!term) return true;
      const haystack = [
        item.claim_number,
        item.claim_title,
        item.provider,
        item.model,
        item.business_line,
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [data.items, search, providerFilter, tierFilter]);

  const summary = data.summary || {};

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with Title and Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold text-foreground flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            AI Billing & Token Consumption History
          </h3>
          <p className="text-xs text-muted-foreground">
            Complete cost ledger across Free Tier providers (Gemini, Groq, Ollama) and Paid models (Anthropic, OpenAI, OpenRouter).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadBillingHistory}
          disabled={loading}
          className="gap-1.5 self-start sm:self-auto text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh History
        </Button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="docket-surface p-4 shadow-none border border-border/80">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            Total Incurred Cost
            <Coins className="h-3.5 w-3.5 text-emerald-500" />
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
            ${Number(summary.total_cost_usd || 0).toFixed(4)}
            <span className="text-xs font-normal text-muted-foreground ml-1">USD</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {summary.paid_tier_runs_count || 0} paid API run(s)
          </p>
        </Card>

        <Card className="docket-surface p-4 shadow-none border border-border/80">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            Free Tier Runs
            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-foreground">
            {summary.free_tier_runs_count || 0}
            <span className="text-xs font-normal text-muted-foreground ml-1">runs ($0.00)</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Gemini, Groq, Ollama, & Free models
          </p>
        </Card>

        <Card className="docket-surface p-4 shadow-none border border-border/80">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            Total Tokens Processed
            <Layers className="h-3.5 w-3.5 text-primary" />
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-foreground">
            {Number(summary.total_tokens || 0).toLocaleString()}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
            {Number(summary.total_input_tokens || 0).toLocaleString()} in / {Number(summary.total_output_tokens || 0).toLocaleString()} out
          </p>
        </Card>

        <Card className="docket-surface p-4 shadow-none border border-border/80">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            Value Saved
            <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
            ~${Number(summary.total_savings_usd || 0).toFixed(3)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Cache hits & Free Tier savings
          </p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="docket-surface p-3 shadow-none border border-border/80">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search claim, model, provider, or business line..."
              className="pl-9 text-xs"
            />
          </div>

          <Select value={providerFilter} onValueChange={setProviderFilter}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="All Providers" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {p === "all" ? "All Providers" : p.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="text-xs">
              <SelectValue placeholder="All Tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Tiers (Free & Paid)</SelectItem>
              <SelectItem value="free" className="text-xs">Free Tier ($0.00) Only</SelectItem>
              <SelectItem value="paid" className="text-xs">Paid Tier Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* History Ledger Table */}
      <Card className="docket-surface overflow-hidden p-0 shadow-none border border-border/80">
        <div className="border-b bg-muted/20 px-5 py-3 flex items-center justify-between text-xs">
          <div className="font-semibold text-foreground flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Audit Ledger ({filteredItems.length} record{filteredItems.length === 1 ? "" : "s"})
          </div>
          <span className="text-muted-foreground">Sorted by most recent run</span>
        </div>

        {error ? (
          <div className="p-8 text-center text-sm text-destructive">{error}</div>
        ) : loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary opacity-70" />
            Loading AI consumption history...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No billing records match the current filters. Run report generations to populate the consumption ledger.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="register-table min-w-[900px] text-xs">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Claim & Context</th>
                  <th>Provider & Model</th>
                  <th>Tokens Breakdown</th>
                  <th>Billing / Cost</th>
                  <th>Tier & Savings</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const u = item.usage || {};
                  const cost = Number(u.estimated_cost_usd || 0);
                  const isFree = u.is_free_tier === true || cost === 0;
                  const tierLabel = u.tier_label || (isFree ? "Free Tier" : "Paid Tier");
                  const savings = Number(u.estimated_savings_usd || 0);

                  return (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      {/* Timestamp */}
                      <td className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {formatTime(item.timestamp)}
                      </td>

                      {/* Claim Reference */}
                      <td>
                        <div className="font-medium text-foreground flex items-center gap-1.5">
                          {item.claim_number}
                          {onSelectClaim && item.claim_id && (
                            <button
                              type="button"
                              onClick={() => onSelectClaim(item.claim_id)}
                              className="text-primary hover:underline inline-flex items-center gap-0.5 text-[10px]"
                              title="Open Claim"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                          {item.claim_title || "General Claim"}
                        </div>
                        {item.business_line && (
                          <span className="text-[10px] text-primary/80 font-medium">
                            {item.business_line}
                          </span>
                        )}
                      </td>

                      {/* Provider & Model */}
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider border-border/80">
                            {item.provider}
                          </Badge>
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground truncate max-w-[200px] mt-0.5">
                          {item.model}
                        </div>
                      </td>

                      {/* Token Breakdown */}
                      <td>
                        <div className="font-mono font-semibold text-foreground">
                          {Number(u.total_tokens || 0).toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">total</span>
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{Number(u.input_tokens || 0).toLocaleString()} in</span>
                          <span>•</span>
                          <span>{Number(u.output_tokens || 0).toLocaleString()} out</span>
                          {u.cache_read_input_tokens > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-emerald-600 font-semibold">{Number(u.cache_read_input_tokens).toLocaleString()} cached</span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Cost */}
                      <td>
                        {isFree ? (
                          <div className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-xs">
                            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                            $0.0000 USD
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 px-2 py-1 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-xs">
                            ${cost.toFixed(4)} USD
                          </div>
                        )}
                      </td>

                      {/* Tier & Savings */}
                      <td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] font-medium ${
                              isFree
                                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {tierLabel}
                          </Badge>
                          {savings > 0.0005 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-0.5">
                              <TrendingDown className="h-2.5 w-2.5" />
                              Saved ~${savings.toFixed(3)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
