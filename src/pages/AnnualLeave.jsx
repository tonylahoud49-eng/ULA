import React, { useEffect, useState, useMemo } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Check, X, UserPlus, Plane } from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function AnnualLeave() {
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(new Date());
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      setEmployees(await appClient.entities.Employee.list());
      setLeaves(await appClient.entities.Leave.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totalRemaining = useMemo(() => employees.reduce((s, e) => s + Math.max(0, (e.annual_leave_total || 15) - (e.annual_leave_used || 0)) + (e.toil_balance || 0), 0), [employees]);

  if (loading) return <div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Annual leave control</h2>
          <p className="docket-subtitle">Track the existing 15-day annual leave allowance, TOIL balances, requests, approvals, and team availability.</p>
        </div>
        <div className="flex gap-2">
          <AddEmployeeDialog onAdded={load} />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="ula-gradient text-white hover:opacity-90"><Plus className="w-4 h-4 mr-2" /> Request Leave</Button></DialogTrigger>
            <LeaveRequestDialog employees={employees} onCreated={() => { setOpen(false); load(); }} />
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
              const annual = Math.max(0, (e.annual_leave_total || 15) - (e.annual_leave_used || 0));
              const total = annual + (e.toil_balance || 0);
              return (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30">
                  <div>
                    <p className="font-medium text-sm">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{e.department || "—"}</p>
                  </div>
                  <div className="flex gap-4 text-right">
                    <div><p className="text-xs text-muted-foreground">Annual</p><p className="font-semibold text-sm">{annual}d</p></div>
                    <div><p className="text-xs text-muted-foreground">TOIL</p><p className="font-semibold text-sm">{e.toil_balance || 0}d</p></div>
                    <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold text-sm text-primary">{total}d</p></div>
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
              <Button size="icon" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}><Plus className="w-4 h-4 rotate-45" /></Button>
              <span className="text-sm font-medium w-32 text-center">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
              <Button size="icon" variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}><Plus className="w-4 h-4 -rotate-45" /></Button>
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
                  <tr key={l.id} className="border-b border-border/50">
                    <td className="py-2.5 font-medium">{l.employee_name}</td>
                    <td className="py-2.5">{l.leave_type}</td>
                    <td className="py-2.5 text-muted-foreground">{l.start_date}</td>
                    <td className="py-2.5 text-muted-foreground">{l.end_date}</td>
                    <td className="py-2.5 text-center">{l.days}</td>
                    <td className="py-2.5"><LeaveBadge status={l.status} /></td>
                    <td className="py-2.5 text-right">
                      {l.status === "Pending" && (
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => approveLeave(l, load)}><Check className="w-4 h-4 text-emerald-600" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => rejectLeave(l, load)}><X className="w-4 h-4 text-red-500" /></Button>
                        </div>
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

function daysBetween(start, end) {
  const s = new Date(start), e = new Date(end);
  return Math.round((e - s) / 86400000) + 1;
}

async function approveLeave(l, reload) {
  await appClient.entities.Leave.update(l.id, { status: "Approved" });
  const emp = await appClient.entities.Employee.get(l.employee_id);
  const used = (emp.annual_leave_used || 0) + (l.leave_type === "Annual Leave" ? l.days : 0);
  const toil = l.leave_type === "TOIL" ? Math.max(0, (emp.toil_balance || 0) - l.days) : emp.toil_balance;
  await appClient.entities.Employee.update(l.employee_id, { annual_leave_used: used, toil_balance: toil });
  await reload();
}

async function rejectLeave(l, reload) {
  await appClient.entities.Leave.update(l.id, { status: "Rejected" });
  await reload();
}

function LeaveRequestDialog({ employees, onCreated }) {
  const [form, setForm] = useState({ employee_id: "", leave_type: "Annual Leave", start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);

  const days = form.start_date && form.end_date ? daysBetween(form.start_date, form.end_date) : 0;
  const emp = employees.find((e) => e.id === form.employee_id);
  const annualLeft = emp ? Math.max(0, (emp.annual_leave_total || 15) - (emp.annual_leave_used || 0)) : 0;
  const toilLeft = emp ? emp.toil_balance || 0 : 0;
  const balance = form.leave_type === "Annual Leave" ? annualLeft : toilLeft;
  const insufficient = days > balance;

  const submit = async () => {
    if (!form.employee_id || days < 1) return;
    setSaving(true);
    try {
      await appClient.entities.Leave.create({
        ...form,
        employee_name: emp?.name || "",
        days,
        status: "Pending",
        requested_date: new Date().toISOString(),
      });
      onCreated();
      setForm({ employee_id: "", leave_type: "Annual Leave", start_date: "", end_date: "" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Request Leave</DialogTitle></DialogHeader>
      <div className="space-y-4 py-2">
        <div>
          <Label>Employee</Label>
          <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
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
        {emp && (
          <div className="p-3 rounded-lg bg-muted text-sm flex justify-between">
            <span className="text-muted-foreground">{form.leave_type} balance: <span className="font-medium text-foreground">{balance} days</span></span>
            <span className="text-muted-foreground">This request: <span className={`font-medium ${insufficient ? "text-red-600" : "text-foreground"}`}>{days} day(s)</span></span>
          </div>
        )}
        {insufficient && <p className="text-xs text-red-600">Insufficient balance for this request.</p>}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving || !form.employee_id || days < 1 || insufficient} className="ula-gradient text-white hover:opacity-90">
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

  const submit = async () => {
    if (!form.name) return;
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
          <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="mt-1" /></div>
            <div><Label>Role</Label><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !form.name} className="ula-gradient text-white hover:opacity-90">{saving ? "Adding…" : "Add Employee"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
