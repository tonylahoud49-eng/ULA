import React, { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatModelDisplayName } from "@/components/AIAnalysisProgressCard";

export default function AIModelSelector({
  value,
  onChange,
  disabled = false,
  className = "",
  enableFallback = true,
  onEnableFallbackChange,
}) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        const list = data.configured_providers && data.configured_providers.length > 0
          ? data.configured_providers
          : [{ provider: data.provider || "anthropic", model: data.model || "claude-sonnet-4-6" }];
        
        setProviders(list);
        
        // Auto-select initial if not set
        if (!value) {
          const saved = localStorage.getItem("ula_ai_selected_provider");
          const found = list.find((p) => p.provider === saved);
          const initial = found ? found.provider : list[0].provider;
          onChange(initial);
        }

        // Initialize fallback check state from localStorage
        const savedFallback = localStorage.getItem("ula_ai_enable_fallback");
        const fallbackValue = savedFallback === null ? true : savedFallback === "true";
        if (onEnableFallbackChange) {
          onEnableFallbackChange(fallbackValue);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSelect = (selectedProvider) => {
    localStorage.setItem("ula_ai_selected_provider", selectedProvider);
    onChange(selectedProvider);
  };

  const handleFallbackChange = (checked) => {
    localStorage.setItem("ula_ai_enable_fallback", String(checked));
    if (onEnableFallbackChange) {
      onEnableFallbackChange(checked);
    }
  };

  if (loading || providers.length === 0) {
    return (
      <div className={`h-9 min-w-[190px] rounded border border-border/80 bg-background px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5 ${className}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
        <span className="truncate">Loading models…</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Select value={value || providers[0]?.provider} onValueChange={handleSelect} disabled={disabled}>
        <SelectTrigger className="h-9 min-w-[210px] max-w-[260px] bg-background text-xs font-medium border-border shadow-xs hover:border-primary/40 focus:ring-1 focus:ring-primary">
          <div className="flex items-center gap-2 truncate">
            <span className="docket-label text-[0.62rem] text-muted-foreground">Model</span>
            <span className="font-mono text-[0.73rem] truncate font-semibold text-foreground">
              {formatModelDisplayName(
                value || providers[0]?.provider,
                providers.find((p) => p.provider === (value || providers[0]?.provider))?.model
              )}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[240px]">
          {providers.map((p) => (
            <SelectItem key={p.provider} value={p.provider} className="text-xs">
              <div className="flex flex-col py-0.5">
                <span className="font-semibold text-foreground">{formatModelDisplayName(p.provider, p.model)}</span>
                <span className="font-mono text-[0.68rem] text-muted-foreground">{p.model}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2.5 rounded-md border border-border bg-background/50 px-3 h-9 shadow-xs hover:border-primary/40 transition-colors">
        <label htmlFor="enable-fallback-toggle" className="docket-label text-[0.62rem] text-muted-foreground cursor-pointer select-none">
          Fallback
        </label>
        <Switch
          id="enable-fallback-toggle"
          checked={enableFallback}
          onCheckedChange={handleFallbackChange}
          disabled={disabled}
          className="h-4 w-7 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-3"
        />
      </div>
    </div>
  );
}
