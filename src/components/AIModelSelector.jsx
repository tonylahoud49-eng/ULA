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
  { value: "gemini", label: "Gemini 3.6 Flash", provider: "gemini", model: "gemini-3.6-flash" },
  { value: "openrouter:openrouter/auto", label: "Auto-Router (Best per Task)", provider: "openrouter", model: "openrouter/auto" },
  { value: "openrouter:minimax/minimax-m3:free", label: "MiniMax M3 (Free · 1M Context)", provider: "openrouter", model: "minimax/minimax-m3:free" },
  { value: "anthropic", label: "Claude Sonnet (4.6)", provider: "anthropic", model: "claude-sonnet-4-6" },
  { value: "openai", label: "GPT-4o", provider: "openai", model: "gpt-4o" },
  { value: "groq", label: "Groq · Llama 3.3 70B", provider: "groq", model: "llama-3.3-70b-versatile" },
  { value: "ollama", label: "Ollama (Local)", provider: "ollama", model: "llama3.3" },
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
        
        if (data.model) {
          setModelList((prev) =>
            prev.map((item) =>
              item.provider === data.provider
                ? { ...item, model: data.model }
                : item
            )
          );
        }

        if (!value) {
          const saved = localStorage.getItem("ula_ai_selected_provider");
          const found = POPULAR_MODELS.find((p) => p.value === saved || p.provider === saved);
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

  const selectedItem = modelList.find((p) => p.value === value || p.provider === value) || modelList[0];

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
        <SelectTrigger className="h-9 min-w-[230px] max-w-[300px] bg-background text-xs font-medium border-border shadow-xs hover:border-primary/40 focus:ring-1 focus:ring-primary">
          <div className="flex items-center gap-2 truncate">
            <span className="docket-label text-[0.62rem] text-muted-foreground">Model</span>
            <span className="font-mono text-[0.73rem] truncate font-semibold text-foreground">
              {selectedItem.label}
            </span>
          </div>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[270px]">
          {modelList.map((p) => (
            <SelectItem key={p.value} value={p.value} className="text-xs">
              <div className="flex flex-col py-0.5">
                <span className="font-semibold text-foreground">{p.label}</span>
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
