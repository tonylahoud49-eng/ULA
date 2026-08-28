import React, { useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2, ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { safeReturnTo } from "@/lib/authReturnTo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const returnTo = safeReturnTo();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await appClient.auth.loginViaEmailPassword(email, password);
      window.location.href = returnTo;
    } catch (loginError) {
      setError(loginError.message || "Access denied. Check your email and ULA system password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Sign in with your approved ULA account"
      footer="Access is granted and managed by ULA system administrators."
    >
      <div className="mb-6 flex items-start gap-3 rounded-md border border-primary/20 bg-primary/[0.035] p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="leading-5 text-muted-foreground">
          This is a closed system. Use your company email and ULA Claims Hub password—not necessarily your Outlook password.
        </p>
      </div>

      {error && (
        <div role="alert" aria-live="polite" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Company email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="email" type="email" autoComplete="email" autoFocus placeholder="name@unitedlossadjusters.com" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 pl-10" required disabled={loading} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">ULA system password</Label>
            <Link to="/forgot-password" className="shrink-0 text-xs text-primary underline-offset-4 hover:underline">Forgot password?</Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="password" type="password" autoComplete="current-password" placeholder="Enter your ULA password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 pl-10" required disabled={loading} />
          </div>
        </div>
        <Button type="submit" className="h-12 w-full font-medium" disabled={loading || !email.trim() || !password}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Signing in…</> : "Log in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
