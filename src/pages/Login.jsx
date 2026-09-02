import React, { useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2, Users, UserCheck, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { safeReturnTo } from "@/lib/authReturnTo";

const GENERIC_TEST_ROLES = [
  {
    name: "Generic Admin",
    designation: "Claims Director & System Approver",
    email: "admin.demo@unitedlossadjusters.com",
    role: "Admin",
    roleColor: "bg-amber-50 text-amber-800 border-amber-300",
  },
  {
    name: "Generic Senior Surveyor",
    designation: "Marine & Cargo Senior Surveyor",
    email: "surveyor.senior@unitedlossadjusters.com",
    role: "Senior Surveyor",
    roleColor: "bg-blue-50 text-blue-800 border-blue-300",
  },
  {
    name: "Generic Claims Handler",
    designation: "Claims Handler & Adjuster",
    email: "handler.demo@unitedlossadjusters.com",
    role: "Claims Handler",
    roleColor: "bg-emerald-50 text-emerald-800 border-emerald-300",
  },
  {
    name: "Generic Marine Surveyor",
    designation: "Field Marine Surveyor",
    email: "surveyor.demo@unitedlossadjusters.com",
    role: "Surveyor",
    roleColor: "bg-cyan-50 text-cyan-800 border-cyan-300",
  },
  {
    name: "Generic Technical Specialist",
    designation: "Engineering & Technical Specialist",
    email: "specialist.demo@unitedlossadjusters.com",
    role: "Specialist",
    roleColor: "bg-indigo-50 text-indigo-800 border-indigo-300",
  },
  {
    name: "Generic Compliance Auditor",
    designation: "Read-Only Compliance & Quality Auditor",
    email: "auditor.demo@unitedlossadjusters.com",
    role: "Auditor",
    roleColor: "bg-slate-50 text-slate-800 border-slate-300",
  },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customEmail, setCustomEmail] = useState("");

  // Post-login destination
  const returnTo = safeReturnTo();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await appClient.auth.loginViaEmailPassword(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(err.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (selectedEmail, selectedName) => {
    setLoading(true);
    try {
      await appClient.auth.loginWithProvider("quick_test", returnTo, selectedEmail, selectedName);
    } catch (err) {
      setError(err.message || "Unable to sign in with test account");
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Log in to United Loss Adjusters & Surveyors"
      footer={
        <>
          Don't have an account?{" "}
          <Link
            to={"/register" + (returnTo !== "/" ? "?returnTo=" + encodeURIComponent(returnTo) : "")}
            className="text-primary font-medium hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <Button
        variant="outline"
        className="w-full h-12 text-sm font-semibold mb-6 border-primary/40 hover:bg-primary/5 text-primary flex items-center justify-center gap-2"
        onClick={() => setShowTeamModal(true)}
      >
        <Users className="w-5 h-5 text-primary" />
        Test Sign In (Generic Roles)
      </Button>

      {showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border w-full max-w-lg rounded-xl shadow-2xl p-6 relative max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b mb-4">
              <div>
                <h3 className="font-heading text-xl font-bold flex items-center gap-2">
                  <UserCheck className="h-5 w-5 text-primary" />
                  Test Sign In · Generic Roles
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select a generic test persona to simulate role permissions.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowTeamModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold px-2 py-1 rounded-md hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 overflow-y-auto pr-1 flex-1 mb-4">
              {GENERIC_TEST_ROLES.map((member) => (
                <button
                  key={member.email}
                  type="button"
                  onClick={() => handleQuickLogin(member.email, member.name)}
                  className="w-full text-left p-3 border rounded-lg hover:bg-primary/5 hover:border-primary/40 transition-all flex justify-between items-center group shadow-xs"
                >
                  <div>
                    <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                      {member.name}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 border rounded-full ${member.roleColor}`}>
                        {member.role}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{member.designation} · <span className="font-mono text-[11px]">{member.email}</span></div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 ml-2" />
                </button>
              ))}
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or sign in with custom test identity:</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Full Name</Label>
                  <Input
                    className="mt-1 h-9 text-xs"
                    placeholder="e.g. Test User"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Email Address</Label>
                  <Input
                    className="mt-1 h-9 text-xs"
                    placeholder="user@unitedlossadjusters.com"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="w-full ula-gradient text-white hover:opacity-90"
                onClick={() => handleQuickLogin(customEmail, customName)}
                disabled={!customEmail}
              >
                Sign In with Custom Test Account
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground font-semibold">or email &amp; password</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm font-medium">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="e.g. petro.zaarour@unitedlossadjusters.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="•••••••• (default: ula123)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-semibold ula-gradient text-white hover:opacity-90" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Logging in...
            </>
          ) : (
            "Log in"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
