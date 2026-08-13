import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, UserCheck, UserMinus, ShieldAlert } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const me = await appClient.auth.me();
      setCurrentUser(me);
      
      // Read directly from auth store
      const AUTH_KEY = "ula_claims_hub_auth_v1";
      const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{"accounts":[]}');
      setUsers(auth.accounts || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateUserStatus = (userId, status) => {
    const AUTH_KEY = "ula_claims_hub_auth_v1";
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{"accounts":[]}');
    auth.accounts = (auth.accounts || []).map(acc => {
      if (acc.id === userId) {
        return { ...acc, status };
      }
      return acc;
    });
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    toast({
      title: "User updated",
      description: `User status changed to ${status}.`,
    });
    loadData();
  };

  const updateUserRole = (userId, role) => {
    const AUTH_KEY = "ula_claims_hub_auth_v1";
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{"accounts":[]}');
    auth.accounts = (auth.accounts || []).map(acc => {
      if (acc.id === userId) {
        return { ...acc, role };
      }
      return acc;
    });
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    toast({
      title: "User updated",
      description: `User role changed to ${role}.`,
    });
    loadData();
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
