import React, { useEffect, useState, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { calculateWorkingDays } from "@/lib/leaveWorkflow";
import { Plus, Check, X, UserPlus, Plane, ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { EmailTestDialog } from "@/components/EmailTestDialog";
import { LeaveEmailAuditDialog } from "@/components/LeaveEmailAuditDialog";
import { NotificationSettingsDialog } from "@/components/NotificationSettingsDialog";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function AnnualLeave() {
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(new Date());
  const [open, setOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const reviewRequestId = useMemo(() => new URLSearchParams(globalThis.location?.search || "").get("request"), []);

  const load = async () => {
    try {
      let [employeeRecords, leaveRecords, user] = await Promise.all([
        appClient.entities.Employee.list(),
        appClient.entities.Leave.list(),
        appClient.auth.me().catch(() => null),
      ]);
      if (user && user.role !== "admin") {
        let matching = employeeRecords.find(
          (e) => (e.email && user.email && e.email.trim().toLowerCase() === user.email.trim().toLowerCase()) ||
                 (e.name && user.full_name && e.name.trim().toLowerCase() === user.full_name.trim().toLowerCase())
        );
        if (!matching && (user.full_name || user.email)) {
          matching = await appClient.entities.Employee.create({
            name: user.full_name || user.email.split("@")[0] || "Employee",
            email: user.email || "",
            department: "Operations",
            role: "Staff",
            annual_leave_total: 15,
            annual_leave_used: 0,
            toil_balance: 0,
            year: new Date().getFullYear(),
          });
          employeeRecords = [...employeeRecords, matching];
        }
      }
      setEmployees(employeeRecords);
      setLeaves(leaveRecords);
      setCurrentUser(user);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!reviewRequestId || loading) return;
    globalThis.document?.getElementById(`leave-request-${reviewRequestId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, reviewRequestId]);

  const totalRemaining = useMemo(() => employees.reduce((s, e) => s + Math.max(0, (e.annual_leave_total ?? 15) - (e.annual_leave_used ?? 0)) + (e.toil_balance ?? 0), 0), [employees]);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Annual leave control</h2>
          <p className="docket-subtitle">Track the existing 15-day annual leave allowance, TOIL balances, requests, approvals, and team availability.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {currentUser?.role === "admin" && (
            <>
              <NotificationSettingsDialog />
              <EmailTestDialog />
              <AddEmployeeDialog onAdded={load} />
            </>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="ula-gradient text-white hover:opacity-90"><Plus className="w-4 h-4 mr-2" /> Request Leave</Button></DialogTrigger>
            <LeaveRequestDialog employees={employees} currentUser={currentUser} onCreated={() => { setOpen(false); load(); }} />
          </Dialog>
        </div>
      </div>

      <div className="metric-strip grid-cols-2 md:grid-cols-4">
        <div className="metric-cell"><p className="docket-label">Employees</p><p className="mt-1 font-heading text-3xl font-semibold">{employees.length}</p></div>
        <div className="metric-cell"><p className="docket-label">Pending requests</p><p className="mt-1 font-heading text-3xl font-semibold">{leaves.filter((l) => l.status === "Pending").length}</p></div>
        <div className="metric-cell"><p className="docket-label">Approved this period</p><p className="mt-1 font-heading text-3xl font-semibold">{leaves.filter((l) => l.status === "Approved").length}</p></div>
        <div className="metric-cell"><p className="docket-label">Days remaining</p><p className="mt-1 font-heading text-3xl font-semibold">{totalRemaining}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="docket-surface p-5 shadow-none">
          <h3 className="mb-4 border-b pb-3 font-heading text-xl font-semibold">Employee balances</h3>
          <div className="space-y-3">
            {employees.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No employees yet.</p> : employees.map((e) => {
              const annual = Math.max(0, (e.annual_leave_total ?? 15) - (e.annual_leave_used ?? 0));
              const total = annual + (e.toil_balance ?? 0);
              return (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{e.name}</p>
                      {currentUser?.role === "admin" && (
                        <EditEmployeeDialog employee={e} onUpdated={load} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {e.email ? (
                        <span className="font-mono text-[11px] text-slate-600">{e.email}</span>
                      ) : (
                        <span className="text-amber-700 font-medium text-[11px]">⚠️ No email set</span>
                      )}
                      {e.department ? ` • ${e.department}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-3 text-right shrink-0">
                    <div><p className="text-[11px] text-muted-foreground">Annual</p><p className="font-semibold text-sm">{annual}d</p></div>
                    <div><p className="text-[11px] text-muted-foreground">TOIL</p><p className="font-semibold text-sm">{e.toil_balance ?? 0}d</p></div>
                    <div><p className="text-[11px] text-muted-foreground">Total</p><p className="font-semibold text-sm text-primary">{total}d</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="docket-surface p-5 shadow-none">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading text-xl font-semibold">Company calendar</h3>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
              <span className="text-sm font-medium w-32 text-center">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
              <Button size="icon" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
          <CalendarGrid viewDate={viewDate} leaves={leaves} />
        </Card>
      </div>

      <Card className="docket-surface p-5 shadow-none">
        <h3 className="mb-4 border-b pb-3 font-heading text-xl font-semibold">Leave requests</h3>
        {leaves.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No leave requests yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Employee</th><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Start</th><th className="pb-2 font-medium">End</th><th className="pb-2 font-medium text-center">Days</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {leaves.slice().reverse().map((l) => (
                  <tr id={`leave-request-${l.id}`} key={l.id} className={`border-b border-border/50 ${reviewRequestId === l.id ? "bg-amber-50/70" : ""}`}>
                    <td className="py-2.5 font-medium">{l.employee_name}</td>
                    <td className="py-2.5">{l.leave_type}</td>
                    <td className="py-2.5 text-muted-foreground">{l.start_date}</td>
                    <td className="py-2.5 text-muted-foreground">{l.end_date}</td>
                    <td className="py-2.5 text-center">{l.days}</td>
                    <td className="py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <LeaveBadge status={l.status} />
                        <LeaveEmailAuditDialog
                          leave={l}
                          employee={employees.find((e) => e.id === l.employee_id)}
                          currentUser={currentUser}
                          onRetried={load}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 text-right">
                      {l.status === "Pending" && currentUser?.role === "admin" && (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Approve request" onClick={() => decideLeave(l, "Approved", load)}><Check className="w-4 h-4 text-emerald-600" /></Button>
                          <Button size="icon" variant="ghost" title="Reject request" onClick={() => decideLeave(l, "Rejected", load)}><X className="w-4 h-4 text-red-500" /></Button>
                        </div>
                      )}
                      {currentUser?.role === "admin" && failedEmailTarget(l) && (
                        <Button size="icon" variant="ghost" title="Retry email notification" onClick={() => retryLeaveEmail(l, load)}>
                          <RefreshCw className="w-4 h-4 text-amber-600" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function CalendarGrid({ viewDate, leaves }) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const approved = leaves.filter((l) => l.status === "Approved");

  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const onLeave = (day) => {
    const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return approved.filter((l) => ds >= l.start_date && ds <= l.end_date);
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map((d) => <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const dayLeaves = d ? onLeave(d) : [];
          return (
            <div key={i} className={`min-h-[52px] p-1 rounded-md border text-xs ${d ? "border-border" : "border-transparent"}`}>
              {d && <div className="font-medium text-muted-foreground">{d}</div>}
              {dayLeaves.slice(0, 2).map((l, j) => (
                <div key={j} className="mt-0.5 px-1 py-0.5 rounded bg-primary/15 text-primary text-[10px] truncate flex items-center gap-1"><Plane className="w-2.5 h-2.5 shrink-0" />{l.employee_name.split(" ")[0]}</div>
              ))}
              {dayLeaves.length > 2 && <div className="text-[10px] text-muted-foreground mt-0.5">+{dayLeaves.length - 2} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LeaveBadge({ status }) {
  const map = { Pending: "border-amber-300 bg-amber-50 text-amber-800", Approved: "border-emerald-300 bg-emerald-50 text-emerald-800", Rejected: "border-red-300 bg-red-50 text-red-800" };
  return <span className={`status-mark ${map[status]}`}>{status}</span>;
}

function failedEmailTarget(leave) {
  const target = leave.status === "Pending" ? "admin_notification" : "employee_notification";
  const delivery = leave.email_delivery?.[target];
  if (delivery?.status === "failed" && delivery.retryable !== false) return target;
  const updatedAt = Date.parse(delivery?.updated_at || leave.updated_date || leave.requested_date || "");
  if (["pending", "sending"].includes(delivery?.status) && Number.isFinite(updatedAt) && Date.now() - updatedAt > 5 * 60_000) return target;
  return null;
}

async function decideLeave(leave, decision, reload) {
  try {
    const result = await appClient.functions.invoke("decideLeaveRequest", { request_id: leave.id, decision });
    if (result.data?.email_error) {
      toast({
        title: `Request ${decision} (Email Failed)`,
        description: `Leave ${decision.toLowerCase()} locally, but automated email failed: ${result.data.email_error}`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `Request ${decision} & Notified`,
        description: `Leave ${decision.toLowerCase()} and notification email dispatched to ${leave.employee_name}.`,
      });
    }
  } catch (error) {
    toast({ title: "Leave request was not updated", description: error.message, variant: "destructive" });
  } finally {
    await reload();
  }
}

async function retryLeaveEmail(leave, reload) {
  const target = failedEmailTarget(leave);
  if (!target) return;
  try {
    const result = await appClient.functions.invoke("retryLeaveNotification", { request_id: leave.id, target });
    if (result.data?.email_error) {
      toast({
        title: "Email Dispatch Failed",
        description: result.data.email_error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Notification Dispatched",
        description: "Email was successfully delivered with single-delivery guarantee.",
      });
    }
  } catch (error) {
    toast({ title: "Email notification was not retried", description: error.message, variant: "destructive" });
  } finally {
    await reload();
  }
}

function LeaveRequestDialog({ employees, currentUser, onCreated }) {
  const isAdmin = currentUser?.role === "admin";

  const userEmployee = useMemo(() => {
    if (!currentUser) return employees[0] || null;
    return (
      employees.find((e) => e.email && currentUser.email && e.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()) ||
      employees.find((e) => e.name && currentUser.full_name && e.name.trim().toLowerCase() === currentUser.full_name.trim().toLowerCase()) ||
      (employees.length === 1 ? employees[0] : null)
    );
  }, [employees, currentUser]);

  const defaultEmpId = !isAdmin && userEmployee ? userEmployee.id : (isAdmin ? "" : employees[0]?.id || "");

  const [form, setForm] = useState({
    employee_id: defaultEmpId,
    leave_type: "Annual Leave",
    start_date: "",
    end_date: "",
    note: "",
  });
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin && userEmployee) {
      setForm((prev) => ({ ...prev, employee_id: userEmployee.id }));
      setEmployeeEmail(userEmployee.email || currentUser?.email || "");
    }
  }, [isAdmin, userEmployee, currentUser]);

  const emp = employees.find((e) => e.id === form.employee_id) || (!isAdmin ? userEmployee : null);
  const days = form.start_date && form.end_date ? calculateWorkingDays(form.start_date, form.end_date) : 0;
  const annualLeft = emp ? Math.max(0, (emp.annual_leave_total ?? 15) - (emp.annual_leave_used ?? 0)) : 0;
  const toilLeft = emp ? emp.toil_balance ?? 0 : 0;
  const balance = form.leave_type === "Annual Leave" ? annualLeft : toilLeft;
  const insufficient = days > balance;

  const validEmpEmail = Boolean(emp?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emp.email.trim()));
  const validDraftEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail.trim());
  const emailResolved = validEmpEmail || validDraftEmail;

  const handleEmployeeChange = (id) => {
    setForm({ ...form, employee_id: id });
    const selected = employees.find((e) => e.id === id);
    setEmployeeEmail(selected?.email || "");
  };

  const submit = async () => {
    if (!form.employee_id || days < 1) return;
    setSaving(true);
    try {
      if (!validEmpEmail && validDraftEmail && emp) {
        await appClient.entities.Employee.update(emp.id, { email: employeeEmail.trim() });
      }
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await appClient.functions.invoke("submitLeaveRequest", { ...form, request_id: requestId, client_request_id: requestId });
      onCreated();
      setForm({ employee_id: defaultEmpId, leave_type: "Annual Leave", start_date: "", end_date: "", note: "" });
      setEmployeeEmail("");
      if (result.data?.email_error) {
        toast({
          title: "Leave Saved (Email Degraded)",
          description: `Request saved with Pending status, but notification email could not be sent: ${result.data.email_error}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Leave Request Submitted & Dispatched",
          description: "Request saved as Pending and review notification email dispatched to administrator.",
        });
      }
    } catch (error) {
      toast({ title: "Leave request was not submitted", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const modalTitle = !isAdmin || emp
    ? `Request Leave — ${emp?.name || currentUser?.full_name || "Employee"}`
    : "Request Leave";

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{modalTitle}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {isAdmin && (
          <div>
            <Label>Employee</Label>
            <Select value={form.employee_id} onValueChange={handleEmployeeChange}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        {emp && !validEmpEmail && (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50/80 text-xs space-y-1.5 animate-in fade-in-50">
            <Label htmlFor="emp-email" className="text-amber-900 font-semibold flex items-center gap-1.5">
              <span>{emp.name}'s Email Address *</span>
            </Label>
            <p className="text-[11px] text-amber-700">
              Required so {emp.name} can receive automated decision notifications.
            </p>
            <Input
              id="emp-email"
              type="email"
              placeholder="e.g. tony@company.com"
              value={employeeEmail}
              onChange={(e) => setEmployeeEmail(e.target.value)}
              className="h-8 text-xs bg-white mt-1 border-amber-300 focus-visible:ring-amber-500"
            />
          </div>
        )}

        {emp && validEmpEmail && (
          <p className="text-[11px] text-muted-foreground">
            Notification target: <span className="font-medium text-foreground">{emp.email}</span>
          </p>
        )}

        <div>
          <Label>Leave Type</Label>
          <Select value={form.leave_type} onValueChange={(v) => setForm({ ...form, leave_type: v })}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Annual Leave">Annual Leave</SelectItem><SelectItem value="TOIL">TOIL</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="mt-1" /></div>
          <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="mt-1" /></div>
        </div>
        <div><Label>Note / reason</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} maxLength={4000} className="mt-1" /></div>
        {emp && (
          <div className="p-3 rounded-lg bg-muted text-sm flex justify-between">
            <span className="text-muted-foreground">{form.leave_type} balance: <span className="font-medium text-foreground">{balance} days</span></span>
            <span className="text-muted-foreground">This request: <span className={`font-medium ${insufficient ? "text-red-600" : "text-foreground"}`}>{days} day(s)</span></span>
          </div>
        )}
        {insufficient && <p className="text-xs text-red-600">Insufficient balance for this request.</p>}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving || !form.employee_id || days < 1 || insufficient || !emailResolved} className="ula-gradient text-white hover:opacity-90">
          {saving ? "Submitting…" : "Submit Request"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AddEmployeeDialog({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", department: "", role: "" });
  const [saving, setSaving] = useState(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const submit = async () => {
    if (!form.name || !validEmail) return;
    setSaving(true);
    try {
      await appClient.entities.Employee.create({ ...form, annual_leave_total: 15, annual_leave_used: 0, toil_balance: 0, year: new Date().getFullYear() });
      onAdded();
      setOpen(false);
      setForm({ name: "", email: "", department: "", role: "" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><UserPlus className="w-4 h-4 mr-2" /> Add Employee</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
          <div><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="mt-1" /></div>
            <div><Label>Role</Label><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !form.name || !validEmail} className="ula-gradient text-white hover:opacity-90">{saving ? "Adding…" : "Add Employee"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEmployeeDialog({ employee, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    name: employee.name || "",
    email: employee.email || "",
    department: employee.department || "",
    role: employee.role || "",
    annual_leave_total: employee.annual_leave_total ?? 15,
    annual_leave_used: employee.annual_leave_used ?? 0,
    toil_balance: employee.toil_balance ?? 0,
  });

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const handleOpen = (val) => {
    if (val) {
      setForm({
        name: employee.name || "",
        email: employee.email || "",
        department: employee.department || "",
        role: employee.role || "",
        annual_leave_total: employee.annual_leave_total ?? 15,
        annual_leave_used: employee.annual_leave_used ?? 0,
        toil_balance: employee.toil_balance ?? 0,
      });
    }
    setOpen(val);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!form.name.trim() || !validEmail) return;
    setSaving(true);
    try {
      await appClient.entities.Employee.update(employee.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        department: form.department.trim(),
        role: form.role.trim(),
        annual_leave_total: Number(form.annual_leave_total) || 15,
        annual_leave_used: Number(form.annual_leave_used) || 0,
        toil_balance: Number(form.toil_balance) || 0,
      });
      toast({
        title: "Employee Profile Updated",
        description: `Updated details for ${form.name} (${form.email}).`,
      });
      setOpen(false);
      if (onUpdated) onUpdated();
    } catch (err) {
      toast({
        title: "Update Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${employee.name}?`)) return;
    setDeleting(true);
    try {
      await appClient.entities.Employee.delete(employee.id);
      toast({
        title: "Employee Removed",
        description: `${employee.name} has been removed.`,
      });
      setOpen(false);
      if (onUpdated) onUpdated();
    } catch (err) {
      toast({
        title: "Delete Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={`Edit ${employee.name}'s profile`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Employee — {employee.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3 py-2 text-xs">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="h-8 text-xs mt-0.5"
            />
          </div>
          <div className="space-y-1">
            <Label>Email Address *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="e.g. tony@company.com"
              className="h-8 text-xs mt-0.5"
            />
            {!validEmail && (
              <p className="text-[10.5px] text-rose-600">A valid email address is required for leave notifications.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label>Department</Label>
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="h-8 text-xs mt-0.5"
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="h-8 text-xs mt-0.5"
              />
            </div>
          </div>

          <div className="pt-2 border-t space-y-2">
            <Label className="text-slate-900 font-semibold">Leave Allowances & Balances</Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Annual Total</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.annual_leave_total}
                  onChange={(e) => setForm({ ...form, annual_leave_total: Number(e.target.value) })}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Annual Used</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.annual_leave_used}
                  onChange={(e) => setForm({ ...form, annual_leave_used: Number(e.target.value) })}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">TOIL Balance</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.toil_balance}
                  onChange={(e) => setForm({ ...form, toil_balance: Number(e.target.value) })}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3 flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !form.name.trim() || !validEmail}
                className="h-8 text-xs ula-gradient text-white"
              >
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
