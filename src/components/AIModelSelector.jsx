import React, { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sparkles, Activity, CheckCircle2, AlertCircle, Loader2, Send, Terminal } from "lucide-react";
import AILogsModal from "@/components/AILogsModal";

export const POPULAR_MODELS = [
  { value: "gemini:gemini-3.6-flash", label: "gemini-3.6-flash", provider: "gemini", model: "gemini-3.6-flash", org: "Google" },
  { value: "openrouter:openrouter/auto", label: "openrouter/auto", provider: "openrouter", model: "openrouter/auto", org: "OpenRouter" },
  { value: "openrouter:minimax/minimax-m3:free", label: "minimax/minimax-m3:free", provider: "openrouter", model: "minimax/minimax-m3:free", org: "OpenRouter" },
  { value: "anthropic:claude-sonnet-4-6", label: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6", org: "Anthropic" },
  { value: "openai:gpt-4o", label: "gpt-4o", provider: "openai", model: "gpt-4o", org: "OpenAI" },
  { value: "groq:llama-3.3-70b-versatile", label: "llama-3.3-70b-versatile", provider: "groq", model: "llama-3.3-70b-versatile", org: "Groq" },
  { value: "ollama:llama3.3", label: "llama3.3", provider: "ollama", model: "llama3.3", org: "Ollama" },
];

export default function AIModelSelector({
  value,
  onChange,
  disabled = false,
  className = "",
  enableFallback = true,
  onEnableFallbackChange,
}) {
  const [modelList, setModelList] = useState(POPULAR_MODELS);
  const [isTestOpen, setIsTestOpen] = useState(false);
  const [testPrompt, setTestPrompt] = useState("Hello! Acknowledge this test and state your model name.");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/ai/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        
        if (data.configured_providers && data.configured_providers.length > 0) {
          setModelList((prev) => {
            const updated = [...prev];
            data.configured_providers.forEach((cp) => {
              const key = `${cp.provider}:${cp.model}`;
              if (!updated.some((item) => item.value === key || item.model === cp.model)) {
                updated.unshift({
                  value: key,
                  label: cp.model,
                  provider: cp.provider,
                  model: cp.model,
                  org: cp.provider.toUpperCase(),
                });
              }
            });
            return updated;
          });
        }

        if (!value) {
          const saved = localStorage.getItem("ula_ai_selected_provider");
          const found = POPULAR_MODELS.find((p) => p.value === saved || p.model === saved || p.provider === saved);
          const initial = found ? found.value : POPULAR_MODELS[0].value;
          onChange(initial);
        }

        const savedFallback = localStorage.getItem("ula_ai_enable_fallback");
        const fallbackValue = savedFallback === null ? true : savedFallback === "true";
        if (onEnableFallbackChange) {
          onEnableFallbackChange(fallbackValue);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleSelect = (selectedKey) => {
    localStorage.setItem("ula_ai_selected_provider", selectedKey);
    onChange(selectedKey);
  };

  const handleFallbackChange = (checked) => {
    localStorage.setItem("ula_ai_enable_fallback", String(checked));
    if (onEnableFallbackChange) {
      onEnableFallbackChange(checked);
    }
  };

  const selectedItem = modelList.find((p) => p.value === value || p.provider === value || p.model === value) || {
    value: value || "gemini:gemini-3.6-flash",
    label: value || "gemini-3.6-flash",
    provider: (value || "").split(":")[0] || "gemini",
    model: (value || "").includes(":") ? (value || "").split(":").slice(1).join(":") : (value || "gemini-3.6-flash"),
    org: "Configured",
  };

  const handleRunTest = async (overridePrompt) => {
    const promptToSend = overridePrompt || testPrompt;
    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/ai/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedItem.provider,
          model: selectedItem.model,
          prompt: promptToSend,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err.message || "Failed to reach AI server.",
        latency_ms: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Select value={selectedItem.value} onValueChange={handleSelect} disabled={disabled}>
        <SelectTrigger className="h-9 min-w-[240px] max-w-[320px] bg-background text-xs font-medium border-border shadow-xs hover:border-primary/40 focus:ring-1 focus:ring-primary">
          <div className="flex items-center gap-2 truncate">
            <span className="docket-label text-[0.62rem] text-muted-foreground uppercase font-semibold">{selectedItem.provider}</span>
            <span className="font-mono text-[0.75rem] truncate font-semibold text-foreground">
              {selectedItem.model}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[300px]">
          {modelList.map((p) => (
            <SelectItem key={p.value} value={p.value} className="text-xs">
              <div className="flex items-center justify-between gap-3 w-full py-0.5">
                <span className="font-mono font-semibold text-foreground text-xs">{p.model}</span>
                <span className="text-[0.62rem] font-sans px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-medium">{p.org || p.provider}</span>
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

      <Dialog open={isTestOpen} onOpenChange={setIsTestOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-medium border-border hover:bg-muted/80 shadow-xs"
            title="Test model live connection and speed"
          >
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span>Test Model</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Model Field Diagnostics
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ping or chat with <strong className="text-foreground">{selectedItem.label}</strong> ({selectedItem.model}) to verify live status, speed, and responses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <Input
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                placeholder="Type a test query or question..."
                className="text-xs h-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !testing) {
                    handleRunTest();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => handleRunTest()}
                disabled={testing || !testPrompt.trim()}
                className="h-9 px-3 gap-1.5 text-xs"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Send className="h-3 w-3" />
                    <span>Ping</span>
                  </>
                )}
              </Button>
            </div>

            {testResult && (
              <div
                className={`rounded-lg border p-3 text-xs space-y-2 ${
                  testResult.ok
                    ? "bg-emerald-500/10 border-emerald-500/20 text-foreground"
                    : "bg-destructive/10 border-destructive/20 text-destructive"
                }`}
              >
                <div className="flex items-center justify-between font-semibold">
                  <div className="flex items-center gap-1.5">
                    {testResult.ok ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">Online & Ready</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <span>Connection Failed</span>
                      </>
                    )}
                  </div>
                  {testResult.latency_ms > 0 && (
                    <span className="font-mono text-[0.7rem] text-muted-foreground">
                      {testResult.latency_ms} ms
                    </span>
                  )}
                </div>

                {testResult.ok ? (
                  <div className="space-y-1.5">
                    {testResult.model && (
                      <div className="font-mono text-[0.68rem] text-muted-foreground">
                        Active Engine: <span className="font-semibold text-foreground">{testResult.model}</span>
                      </div>
                    )}
                    <div className="rounded bg-background/80 p-2 text-xs border border-border text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {testResult.reply}
                    </div>
                  </div>
                ) : (
                  <div className="rounded bg-destructive/10 p-2 text-xs border border-destructive/20 text-destructive whitespace-pre-wrap">
                    {testResult.error}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AILogsModal
        triggerButton={
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-medium border-border hover:bg-muted/80 shadow-xs"
            title="View real-time server AI analysis logs and diagnostics"
          >
            <Terminal className="h-3.5 w-3.5 text-primary" />
            <span>AI Logs</span>
          </Button>
        }
      />
    </div>
  );
}
