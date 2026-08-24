import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { appClient } from "@/api/appClient";
import { toast } from "@/components/ui/use-toast";
import {
  Mail,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  Send,
  Eye,
  Bot,
  ShieldCheck,
} from "lucide-react";

export function LeaveEmailAuditDialog({ leave, employee, currentUser, onRetried, trigger }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [activeTab, setActiveTab] = useState("audit"); // "audit" | "preview"

  const target = leave.status === "Pending" ? "admin_notification" : "employee_notification";
  const delivery = leave.email_delivery?.[target];
  const isSent = delivery?.status === "sent";
  const isFailed = delivery?.status === "failed";
  const isPending = !delivery || ["pending", "sending"].includes(delivery?.status);

  const recipientEmail = leave.status === "Pending" ? "Leave Administrator" : (leave.employee_email || employee?.email);

  const handleRetry = async () => {
    if (!currentUser || currentUser.role !== "admin") return;
    setRetrying(true);
    try {
      const result = await appClient.functions.invoke("retryLeaveNotification", {
        request_id: leave.id,
        target,
      });

      if (result.data?.email_error) {
        toast({
          title: "Email Dispatch Failed",
          description: result.data.email_error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Notification Email Dispatched",
          description: `Successfully delivered to ${recipientEmail}.`,
        });
      }
      if (onRetried) await onRetried();
    } catch (err) {
      toast({
        title: "Retry Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  };

  const defaultTrigger = (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded-full text-[10.5px] font-medium border transition-colors cursor-pointer ${
        isSent
          ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80"
          : isFailed
          ? "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100/80 animate-pulse"
          : "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100/80"
      }`}
      title="Click to view email delivery audit & preview"
    >
      {isSent ? (
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
      ) : isFailed ? (
        <AlertTriangle className="w-3 h-3 text-rose-600" />
      ) : (
        <Clock className="w-3 h-3 text-amber-600 animate-spin" />
      )}
      <span>{isSent ? "Email Delivered" : isFailed ? "Email Failed (Audit)" : "Email Sending..."}</span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b bg-slate-50/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-lg ${isSent ? "bg-emerald-100 text-emerald-700" : isFailed ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">Email Delivery Audit & Inspector</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Request #{leave.id} • {leave.employee_name} ({leave.leave_type})
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("audit")}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === "audit" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Audit Details
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === "preview" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Email Preview
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {activeTab === "audit" ? (
            <>
              {/* Delivery Status Card */}
              <div className={`p-3.5 rounded-lg border text-xs flex items-start gap-3 ${
                isSent
                  ? "bg-emerald-50/60 border-emerald-200 text-emerald-900"
                  : isFailed
                  ? "bg-rose-50/60 border-rose-200 text-rose-900"
                  : "bg-amber-50/60 border-amber-200 text-amber-900"
              }`}>
                {isSent ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : isFailed ? (
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                ) : (
                  <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-semibold text-sm">
                    {isSent ? "Notification Successfully Delivered" : isFailed ? "Email Dispatch Failed" : "Notification Dispatch In Progress"}
                  </div>
                  <p className="mt-0.5 opacity-90 text-[11.5px]">
                    {isSent
                      ? "The automated notification was transmitted to the recipient mailbox with safe delivery confirmation."
                      : isFailed
                      ? delivery?.error || "The email service encountered a network error or missing credentials."
                      : "The notification is queued or currently sending."}
                  </p>
                </div>
              </div>

              {/* Audit Metadata Table */}
              <div className="border rounded-lg overflow-hidden text-xs">
                <div className="bg-slate-100/70 px-3.5 py-2 font-medium text-slate-700 border-b">
                  Delivery Metadata
                </div>
                <div className="divide-y text-slate-700">
                  <div className="grid grid-cols-3 px-3.5 py-2">
                    <span className="text-muted-foreground">Notification Target</span>
                    <span className="col-span-2 font-medium">
                      {target === "admin_notification" ? "Admin Review Notice (Submission)" : "Employee Decision Notice (Approval/Rejection)"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-3.5 py-2">
                    <span className="text-muted-foreground">Recipient (To)</span>
                    <span className="col-span-2 font-mono font-medium text-slate-900">
                      {leave.status === "Pending" ? "Configured Admin Email" : leave.employee_email}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 px-3.5 py-2">
                    <span className="text-muted-foreground">Dispatch Attempts</span>
                    <span className="col-span-2">{delivery?.attempts || 1} attempt(s)</span>
                  </div>
                  <div className="grid grid-cols-3 px-3.5 py-2">
                    <span className="text-muted-foreground">Idempotency Key</span>
                    <span className="col-span-2 font-mono text-[11px] text-slate-600 truncate">
                      {delivery?.idempotency_key || `leave:${leave.id}:${leave.status.toLowerCase()}`}
                    </span>
                  </div>
                  {delivery?.sent_at && (
                    <div className="grid grid-cols-3 px-3.5 py-2">
                      <span className="text-muted-foreground">Delivered At</span>
                      <span className="col-span-2">{new Date(delivery.sent_at).toLocaleString()}</span>
                    </div>
                  )}
                  {delivery?.updated_at && (
                    <div className="grid grid-cols-3 px-3.5 py-2">
                      <span className="text-muted-foreground">Last Status Update</span>
                      <span className="col-span-2">{new Date(delivery.updated_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Email Preview Tab */
            <div className="border rounded-lg overflow-hidden bg-slate-50 text-xs">
              <div className="bg-[#0f2744] text-white p-3.5 border-b flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">ULA Claims & Operations Hub</div>
                  <div className="text-[11px] text-blue-200">
                    Subject: [ULA Leave] {leave.status === "Pending" ? `Review required: ${leave.employee_name}` : `Request ${leave.status.toLowerCase()}`}: {leave.leave_type}
                  </div>
                </div>
                <span className="text-[10px] bg-blue-900/60 px-2 py-0.5 rounded border border-blue-400/30">HTML Preview</span>
              </div>
              <div className="p-4 space-y-3 bg-white">
                <p className="font-medium text-slate-800">
                  {leave.status === "Pending"
                    ? "A new leave request has been submitted and is awaiting your review:"
                    : `Your leave request has been ${leave.status.toLowerCase()}:`}
                </p>

                <table className="w-full border-collapse border border-slate-200 text-xs">
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <th className="bg-slate-50 p-2 text-left w-1/3 text-slate-600 font-medium">Employee</th>
                      <td className="p-2 text-slate-900 font-medium">{leave.employee_name}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <th className="bg-slate-50 p-2 text-left text-slate-600 font-medium">Leave Type</th>
                      <td className="p-2 text-slate-900">{leave.leave_type}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <th className="bg-slate-50 p-2 text-left text-slate-600 font-medium">Dates & Days</th>
                      <td className="p-2 text-slate-900">{leave.start_date} to {leave.end_date} ({leave.days} working days)</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <th className="bg-slate-50 p-2 text-left text-slate-600 font-medium">Reason / Note</th>
                      <td className="p-2 text-slate-900">{leave.note || "None provided"}</td>
                    </tr>
                    <tr>
                      <th className="bg-slate-50 p-2 text-left text-slate-600 font-medium">Request Status</th>
                      <td className="p-2 font-semibold text-primary">{leave.status}</td>
                    </tr>
                  </tbody>
                </table>

                {/* ULA BOT Signature & Disclaimer */}
                <div className="pt-3 border-t border-slate-200 text-[11px] text-slate-500 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                    <span>🤖 ULA BOT — Automated Notification Engine</span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    This is an automated notification from the ULA Annual Leave / TOIL workflow system.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-slate-50/70 flex items-center justify-between sm:justify-between">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Idempotency-guaranteed single delivery</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8 text-xs"
            >
              Close
            </Button>
            {currentUser?.role === "admin" && (
              <Button
                type="button"
                size="sm"
                onClick={handleRetry}
                disabled={retrying}
                className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {retrying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Retrying...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>{isFailed ? "Retry Dispatch Now" : "Re-dispatch Notification"}</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
