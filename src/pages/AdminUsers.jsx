import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Shield, UserCheck, UserMinus, ShieldAlert, UserPlus } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const [me, accounts] = await Promise.all([
        appClient.auth.me(),
        appClient.auth.listAccounts(),
      ]);
      setCurrentUser(me);
      setUsers(accounts || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateUserStatus = async (userId, status) => {
    try {
      await appClient.auth.updateAccount(userId, { status });
      toast({
        title: "User updated",
        description: `User status changed to ${status}.`,
      });
      loadData();
    } catch (err) {
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    }
  };

  const updateUserRole = async (userId, role) => {
    try {
      await appClient.auth.updateAccount(userId, { role });
      toast({
        title: "User updated",
        description: `User role changed to ${role}.`,
      });
      loadData();
    } catch (err) {
      toast({ variant: "destructive", title: "Update failed", description: err.message });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">User administration</h2>
          <p className="docket-subtitle">Review local accounts, manage access status, and assign administrator authority.</p>
        </div>
        <div>
          <AddUserDialog onCreated={loadData} />
        </div>
      </div>

      <Card className="docket-surface overflow-hidden shadow-none">
        <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2 font-heading font-semibold text-sm">
            <Shield className="w-4 h-4 text-primary" /> Active Accounts ({users.length})
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="register-table">
            <thead>
              <tr>
                <th>User Details</th>
                <th>Role</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((acc) => (
                <tr key={acc.id} className={acc.id === currentUser?.id ? "bg-primary/[0.015]" : ""}>
                  <td>
                    <div className="font-semibold flex items-center gap-1.5">
                      {acc.full_name || "Unknown User"}
                      {acc.id === currentUser?.id && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-normal">You</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{acc.email}</div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${acc.role === "admin" ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-slate-50 border border-slate-200 text-slate-700"}`}>
                      {acc.role === "admin" ? <ShieldAlert className="w-3 h-3" /> : null}
                      {acc.role === "admin" ? "Administrator" : "Standard User"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-mark ${acc.status === "approved" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                      {acc.status === "approved" ? "Access Granted" : "Pending Approval"}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {acc.id !== currentUser?.id && (
                        <>
                          {acc.status === "approved" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => updateUserStatus(acc.id, "pending")}
                              className="h-8 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                            >
                              <UserMinus className="w-3.5 h-3.5 mr-1" /> Revoke
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => updateUserStatus(acc.id, "approved")}
                              className="h-8 ula-gradient text-white"
                            >
                              <UserCheck className="w-3.5 h-3.5 mr-1" /> Approve
                            </Button>
                          )}
                          {acc.role === "admin" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateUserRole(acc.id, "user")}
                              className="h-8 text-xs"
                            >
                              Demote
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateUserRole(acc.id, "admin")}
                              className="h-8 text-xs text-primary"
                            >
                              Make Admin
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AddUserDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "password123",
    role: "user",
  });

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!form.full_name.trim() || !validEmail) return;
    setSaving(true);
    try {
      await appClient.auth.createAccount({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        role: form.role,
        status: "approved",
        password: form.password || "password123",
      });
      toast({
        title: "User Account Created",
        description: `Account created for ${form.full_name} (${form.email}).`,
      });
      setOpen(false);
      setForm({ full_name: "", email: "", password: "password123", role: "user" });
      if (onCreated) onCreated();
    } catch (err) {
      toast({
        title: "Creation Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="ula-gradient text-white hover:opacity-90 gap-1.5">
          <UserPlus className="w-4 h-4" />
          <span>Add User Account</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Add User Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3.5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="user-fullname" className="text-xs font-medium">
              Full Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="user-fullname"
              required
              placeholder="e.g. Jane Doe"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email" className="text-xs font-medium">
              Email Address <span className="text-red-500">*</span>
            </Label>
            <Input
              id="user-email"
              type="email"
              required
              placeholder="e.g. jane@company.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Role</Label>
              <Select value={form.role} onValueChange={(val) => setForm({ ...form, role: val })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Standard User</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-password" className="text-xs font-medium">Password</Label>
              <Input
                id="user-password"
                type="password"
                placeholder="password123"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !form.full_name.trim() || !validEmail}
              className="h-8 text-xs ula-gradient text-white"
            >
              {saving ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
