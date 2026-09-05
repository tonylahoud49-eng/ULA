import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KeyRound, Mail, ShieldAlert, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

const EMPTY_EMPLOYEE = { full_name: "", email: "", job_title: "", password: "", role: "user" };

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [me, accounts] = await Promise.all([appClient.auth.me(), appClient.auth.listAccounts()]);
      setCurrentUser(me);
      setUsers(accounts || []);
    } catch (error) {
      toast({ variant: "destructive", title: "Accounts could not be loaded", description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const updateUserStatus = async (userId, status) => {
    try {
      await appClient.auth.updateAccount(userId, { status });
      toast({ title: status === "approved" ? "Access granted" : "Access revoked", description: "The employee account was updated." });
      await loadData();
    } catch (error) {
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  };

  const updateUserRole = async (userId, role) => {
    try {
      await appClient.auth.updateAccount(userId, { role });
      toast({ title: role === "admin" ? "Administrator access granted" : "Standard access restored", description: "The employee's job title was not changed." });
      await loadData();
    } catch (error) {
      toast({ variant: "destructive", title: "Update failed", description: error.message });
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20" role="status" aria-label="Loading employee accounts"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" /></div>;
  }

  const approvedCount = users.filter((user) => user.status === "approved").length;
  const adminCount = users.filter((user) => user.role === "admin").length;

  return (
    <div className="space-y-6">
      <div className="docket-header gap-4">
        <div>
          <h2 className="docket-title">Employee access</h2>
          <p className="docket-subtitle">Manage ULA employee profiles, application access, job titles, and temporary passwords.</p>
        </div>
        <AddEmployeeDialog onCreated={loadData} />
      </div>

      <div className="metric-strip grid-cols-1 sm:grid-cols-3">
        <Metric label="Employee accounts" value={users.length} />
        <Metric label="Access granted" value={approvedCount} />
        <Metric label="Administrators" value={adminCount} />
      </div>

      <Card className="docket-surface overflow-hidden p-0 shadow-none">
        <div className="flex items-center justify-between border-b bg-muted/20 px-5 py-4">
          <div className="flex items-center gap-2 font-heading text-base font-semibold"><Users className="h-4 w-4 text-primary" aria-hidden="true" /> ULA employee directory</div>
          <span className="hidden text-xs text-muted-foreground sm:block">Outlook email is used as the app login</span>
        </div>

        {users.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="font-heading text-xl font-semibold">No employee accounts yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Use Add Employee to create the first profile and login.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="register-table min-w-[980px]">
              <thead><tr><th>Employee</th><th>Job title</th><th>App access</th><th>Status</th><th>Password</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {users.map((account) => {
                  const isCurrentUser = account.id === currentUser?.id;
                  return (
                    <tr key={account.id} className={isCurrentUser ? "bg-primary/[0.025]" : ""}>
                      <td>
                        <div className="flex items-center gap-2 font-semibold">{account.full_name || "Unknown employee"}{isCurrentUser && <span className="status-mark border-primary/25 bg-primary/5 text-primary">You</span>}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3.5 w-3.5" aria-hidden="true" /><span>{account.email}</span></div>
                      </td>
                      <td className="max-w-[230px] text-sm">{account.job_title || "Not assigned"}</td>
                      <td><AccessMark role={account.role} /></td>
                      <td><StatusMark status={account.status} /></td>
                      <td><span className="text-xs text-muted-foreground">{account.password_status === "temporary" ? "Temporary" : "Set"}</span></td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ResetPasswordDialog account={account} />
                          {!isCurrentUser && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => updateUserStatus(account.id, account.status === "approved" ? "revoked" : "approved")} className={account.status === "approved" ? "h-8 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive" : "h-8"}>
                                {account.status === "approved" ? <UserMinus className="mr-1 h-3.5 w-3.5" /> : <UserCheck className="mr-1 h-3.5 w-3.5" />}{account.status === "approved" ? "Revoke" : "Approve"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => updateUserRole(account.id, account.role === "admin" ? "user" : "admin")} className="h-8 text-xs">
                                {account.role === "admin" ? "Make employee" : "Make admin"}
                              </Button>
                            </>
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

function Metric({ label, value }) {
  return <div className="metric-cell"><p className="docket-label">{label}</p><p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{value}</p></div>;
}

function AccessMark({ role }) {
  if (role === "admin") {
    return <span className="status-mark border-amber-300 bg-amber-50 text-amber-800"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />Administrator</span>;
  }
  return <span className="status-mark border-slate-300 bg-slate-50 text-slate-700">Employee</span>;
}

function StatusMark({ status }) {
  return <span className={`status-mark ${status === "approved" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-800"}`}>{status === "approved" ? "Access granted" : "Access revoked"}</span>;
}

function AddEmployeeDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_EMPLOYEE);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const validPassword = form.password.length >= 8;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const handleOpen = (nextOpen) => { setOpen(nextOpen); if (!nextOpen) setForm(EMPTY_EMPLOYEE); };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim() || !form.job_title.trim() || !validEmail || !validPassword) return;
    setSaving(true);
    try {
      await appClient.auth.createEmployeeAccount({ full_name: form.full_name.trim(), email: form.email.trim(), job_title: form.job_title.trim(), role: form.role, password: form.password });
      toast({ title: "Employee added", description: `${form.full_name} can now sign in with ${form.email}.` });
      handleOpen(false);
      await onCreated?.();
    } catch (error) {
      toast({ title: "Employee could not be added", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild><Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"><UserPlus className="h-4 w-4" aria-hidden="true" /> Add Employee</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Add employee</DialogTitle><DialogDescription>Create the employee profile and application login together.</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <Field label="Full name" id="employee-name"><Input id="employee-name" required autoComplete="name" value={form.full_name} onChange={(event) => setField("full_name", event.target.value)} /></Field>
          <Field label="Outlook email / app login" id="employee-email"><Input id="employee-email" type="email" required autoComplete="email" placeholder="name@unitedlossadjusters.com" value={form.email} onChange={(event) => setField("email", event.target.value)} /></Field>
          <Field label="Job title" id="employee-job-title"><Input id="employee-job-title" required placeholder="e.g. Claims Handler" value={form.job_title} onChange={(event) => setField("job_title", event.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Application access</Label><Select value={form.role} onValueChange={(value) => setField("role", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">Employee</SelectItem><SelectItem value="admin">Administrator</SelectItem></SelectContent></Select></div>
            <Field label="Temporary app password" id="employee-password"><PasswordInput id="employee-password" minLength={8} required autoComplete="new-password" placeholder="Minimum 8 characters" value={form.password} onChange={(event) => setField("password", event.target.value)} /></Field>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">This password opens ULA Claims Hub only. It does not create or change the employee's Microsoft Outlook password.</p>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => handleOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !form.full_name.trim() || !form.job_title.trim() || !validEmail || !validPassword}>{saving ? "Adding employee…" : "Add Employee"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, id, children }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function ResetPasswordDialog({ account }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const handleOpen = (nextOpen) => { setOpen(nextOpen); if (!nextOpen) setPassword(""); };

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) return;
    setSaving(true);
    try {
      await appClient.auth.setAccountPassword(account.id, password);
      toast({ title: "Password updated", description: `${account.full_name} can use the new app password immediately.` });
      handleOpen(false);
    } catch (error) {
      toast({ title: "Password could not be updated", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline" className="h-8" aria-label={`Reset password for ${account.full_name}`}><KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Reset</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[430px]">
        <DialogHeader><DialogTitle>Reset app password</DialogTitle><DialogDescription>Set a new password for {account.full_name}. Their Outlook password is not affected.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-1">
          <Field label="New app password" id={`reset-password-${account.id}`}><PasswordInput id={`reset-password-${account.id}`} minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => handleOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || password.length < 8}>{saving ? "Updating…" : "Update password"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
