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
import { Terminal, RefreshCw, Trash2, CheckCircle2, AlertCircle, Info } from "lucide-react";

export default function AILogsModal({ triggerButton, open, onOpenChange }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      await fetch("/api/ai/logs", { method: "DELETE" });
      setLogs([]);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (onOpenChange) onOpenChange(val);
      if (val) fetchLogs();
    }}>
      {triggerButton && <DialogTrigger asChild>{triggerButton}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Terminal className="h-4 w-4 text-primary" />
              AI Analysis Server Logs
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchLogs}
                disabled={loading}
                className="h-8 px-2.5 text-xs gap-1.5"
                title="Refresh logs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearLogs}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
                title="Clear logs"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <DialogDescription className="text-xs">
            Live server events, extraction character counts, and exact model API responses/errors.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-[300px] overflow-hidden rounded-md border bg-muted/40 p-1">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-xs text-muted-foreground">
              <Terminal className="h-8 w-8 mb-2 opacity-30" />
              <span>No AI analysis events logged yet.</span>
              <span className="text-[0.7rem] text-muted-foreground/70 mt-0.5">
                Run an analysis or test ping to see live logs here.
              </span>
            </div>
          ) : (
            <ScrollArea className="h-[420px] p-2 space-y-2">
              {logs.map((log) => {
                const isError = log.level === "error";
                const isWarn = log.level === "warn";
                const time = new Date(log.timestamp).toLocaleTimeString();

                return (
                  <div
                    key={log.id || log.timestamp}
                    className={`rounded-md border p-2.5 text-xs mb-2 ${
                      isError
                        ? "bg-destructive/10 border-destructive/20 text-destructive"
                        : isWarn
                        ? "bg-amber-500/10 border-amber-500/20 text-foreground"
                        : "bg-background border-border text-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[0.68rem] text-muted-foreground mb-1">
                      <div className="flex items-center gap-1.5 font-mono">
                        {isError ? (
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        ) : isWarn ? (
                          <Info className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        )}
                        <span className="font-semibold uppercase tracking-wider">
                          [{log.level}]
                        </span>
                      </div>
                      <span className="font-mono">{time}</span>
                    </div>

                    <div className="font-medium text-xs whitespace-pre-wrap">{log.message}</div>

                    {log.data && (
                      <pre className="mt-1.5 rounded bg-muted/70 p-2 font-mono text-[0.68rem] text-muted-foreground overflow-x-auto max-h-36">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
