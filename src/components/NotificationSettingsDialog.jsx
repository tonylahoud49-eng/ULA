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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import {
  Settings2,
  CheckCircle2,
  AlertCircle,
  Mail,
  Users,
  Save,
} from "lucide-react";

const SETTINGS_KEY = "ula_notification_settings";

export function getStoredNotificationSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    enabled: true,
    routing_mode: "extended", // "simple" | "extended"
    hr_email: "hr@company.com",
    cc_hr_on_approval: true,
    cc_manager_on_submission: true,
  };
}

export function NotificationSettingsDialog({ triggerButton }) {
  const [open, setOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [settings, setSettings] = useState(getStoredNotificationSettings);

  const fetchDiagnostics = async () => {
    try {
      const res = await fetch("/api/email/diagnostics");
      if (res.ok) {
        setDiagnostics(await res.json());
      }
    } catch {}
  };

  useEffect(() => {
    if (open) {
      setSettings(getStoredNotificationSettings());
      fetchDiagnostics();
    }
  }, [open]);

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    toast({
      title: "Notification Settings Saved",
      description: `Routing mode set to ${settings.routing_mode === "extended" ? "Manager & HR CC" : "Simple 1-to-1"}.`,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline" size="sm" className="gap-2 h-9">
            <Settings2 className="w-4 h-4 text-slate-600" />
            <span>Notification Settings</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Notification & Routing Settings</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Adjust leave notification delivery, recipient carbon-copy rules, and routing modes.
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
                  ({diagnostics.configured ? "Ready" : "Credentials incomplete"})
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 py-2 text-xs">
          {/* Master Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-slate-50">
            <div className="space-y-0.5">
              <div className="font-medium text-slate-900">Enable Automated Leave Emails</div>
              <div className="text-[11px] text-slate-500">Dispatch emails on leave submissions and approval/rejection decisions.</div>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(val) => setSettings({ ...settings, enabled: val })}
            />
          </div>

          {/* Routing Mode Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-900">Routing Mode</Label>
            <div className="grid grid-cols-2 gap-2.5">
              <div
                onClick={() => setSettings({ ...settings, routing_mode: "simple" })}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  settings.routing_mode === "simple"
                    ? "border-primary bg-primary/5 ring-1 ring-primary text-primary"
                    : "border-slate-200 hover:border-slate-300 text-slate-700"
                }`}
              >
                <div className="font-medium flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Simple (1-to-1)</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Submission $\rightarrow$ Admin only.<br />
                  Decision $\rightarrow$ Employee only.
                </div>
              </div>

              <div
                onClick={() => setSettings({ ...settings, routing_mode: "extended" })}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  settings.routing_mode === "extended"
                    ? "border-primary bg-primary/5 ring-1 ring-primary text-primary"
                    : "border-slate-200 hover:border-slate-300 text-slate-700"
                }`}
              >
                <div className="font-medium flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  <span>Manager & HR CC</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Submission $\rightarrow$ Admin + Manager CC.<br />
                  Approval $\rightarrow$ Employee + HR CC.
                </div>
              </div>
            </div>
          </div>

          {/* Additional CC Settings */}
          {settings.routing_mode === "extended" && (
            <div className="space-y-3 p-3 rounded-lg border bg-slate-50/50">
              <div className="space-y-1.5">
                <Label htmlFor="hr-email" className="text-xs font-medium">HR & Payroll Notification Email</Label>
                <Input
                  id="hr-email"
                  type="email"
                  placeholder="hr@company.com"
                  value={settings.hr_email}
                  onChange={(e) => setSettings({ ...settings, hr_email: e.target.value })}
                  className="h-8 text-xs bg-white"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-700">CC HR on Approved Requests</span>
                <Switch
                  checked={settings.cc_hr_on_approval}
                  onCheckedChange={(val) => setSettings({ ...settings, cc_hr_on_approval: val })}
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-700">CC Line Manager on Submissions</span>
                <Switch
                  checked={settings.cc_manager_on_submission}
                  onCheckedChange={(val) => setSettings({ ...settings, cc_manager_on_submission: val })}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="h-8 text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground">
            <Save className="w-3.5 h-3.5" />
            <span>Save Settings</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
