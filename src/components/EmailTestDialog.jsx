import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { Mail, Send, CheckCircle2, AlertCircle, Loader2, Bot, ShieldCheck } from "lucide-react";

export function EmailTestDialog({ triggerButton }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [form, setForm] = useState({
    to: "",
    cc: "",
    subject: "[ULA System Test] Automated Email Verification",
    message: "This is an automated test message verifying that the ULA email dispatch service and mailbox routing are operational.",
  });

  const fetchDiagnostics = async () => {
    try {
      const res = await fetch("/api/email/diagnostics");
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
      }
    } catch {
      // Backend not running or diagnostics route unreachable
    }
  };

  useEffect(() => {
    if (open) {
      fetchDiagnostics();
    }
  }, [open]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!form.to.trim()) {
      toast({
        title: "Recipient Required",
        description: "Please specify a valid 'To' email address.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.to.trim(),
          cc: form.cc.trim() || undefined,
          subject: form.subject.trim(),
          message: form.message.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Failed to send test email.");
      }

      toast({
        title: "Test Email Dispatched",
        description: `Sent via ${data.provider === "emailjs" ? "EmailJS" : "Microsoft Graph"} to ${form.to}${form.cc ? ` (CC: ${form.cc})` : ""}.`,
      });

      setOpen(false);
    } catch (err) {
      toast({
        title: "Email Dispatch Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm" className="gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <span>Test Email Dispatch</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">ULA BOT — Test Email Dispatch</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dispatch an automated diagnostic message with recipient routing, ULA BOT signature, and disclaimer.
              </p>
            </div>
          </div>
        </DialogHeader>

        {diagnostics && (
          <div className={`p-2.5 rounded-md border text-xs flex items-start gap-2 ${
            diagnostics.configured
              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
              : "bg-amber-50/70 border-amber-200 text-amber-900"
          }`}>
            {diagnostics.configured ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className="font-medium">
                Active Provider: {diagnostics.provider === "emailjs" ? "EmailJS" : "Microsoft Graph API"}
                <span className="ml-2 font-normal opacity-80">
                  ({diagnostics.configured ? "Configured & Ready" : "Missing credentials in .env"})
                </span>
              </div>
              {!diagnostics.configured && diagnostics.missing?.length > 0 && (
                <div className="text-[11px] text-amber-800 mt-0.5">
                  Missing variables: {diagnostics.missing.join(", ")}
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-3.5 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="test-to" className="text-xs font-medium">
                Recipient (To) <span className="text-red-500">*</span>
              </Label>
              <Input
                id="test-to"
                type="email"
                required
                placeholder="colleague@company.com"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-cc" className="text-xs font-medium">
                Carbon Copy (CC) <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="test-cc"
                type="email"
                placeholder="manager@company.com"
                value={form.cc}
                onChange={(e) => setForm({ ...form, cc: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="test-subject" className="text-xs font-medium">
              Subject Line
            </Label>
            <Input
              id="test-subject"
              type="text"
              required
              placeholder="Email subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="test-message" className="text-xs font-medium">
              Test Message Body
            </Label>
            <Textarea
              id="test-message"
              rows={3}
              placeholder="Type your test message..."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="text-xs resize-none"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-2 text-[11px] text-slate-600 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Includes <strong>🤖 ULA BOT signature</strong>, dispatch timestamp table, and formal confidentiality disclaimer.</span>
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading}
              className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Dispatching...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Email</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
