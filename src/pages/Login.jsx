import React, { useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showGoogleMock, setShowGoogleMock] = useState(false);
  const [customGoogleEmail, setCustomGoogleEmail] = useState("");
  const [customGoogleName, setCustomGoogleName] = useState("");
  
  // Post-login destination (e.g. the MCP OAuth consent page sends users here
  // with returnTo so the grant flow can resume). Same-origin paths only.
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

  const handleGoogleLogin = (selectedEmail, selectedName) => {
    appClient.auth.loginWithProvider("google", returnTo, selectedEmail, selectedName);
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Log in to your account"
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
        className="w-full h-12 text-sm font-medium mb-6"
        onClick={() => setShowGoogleMock(true)}
      >
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continue with Google
      </Button>

      {showGoogleMock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border w-full max-w-md rounded-lg shadow-xl p-6 relative">
            <h3 className="font-heading text-xl font-bold mb-2">Google Single Sign-On</h3>
            <p className="text-xs text-muted-foreground mb-4">Choose a mock identity to simulate the Google workspace sign-in flow.</p>
            
            <div className="space-y-2 mb-6">
              <button
                type="button"
                onClick={() => handleGoogleLogin("admin@ula.com", "ULA Administrator")}
                className="w-full text-left p-3 border rounded-md hover:bg-muted/50 transition-colors flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-sm">Sign in as Administrator</div>
                  <div className="text-xs text-muted-foreground">admin@ula.com (Pre-approved Admin)</div>
                </div>
                <span className="text-[10px] bg-amber-50 text-amber-700 font-semibold px-2 py-0.5 border border-amber-200 rounded">Admin</span>
              </button>

              <button
                type="button"
                onClick={() => handleGoogleLogin("john.doe@ula.com", "John Doe")}
                className="w-full text-left p-3 border rounded-md hover:bg-muted/50 transition-colors flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-sm">Sign in with Corporate Account</div>
                  <div className="text-xs text-muted-foreground">john.doe@ula.com (Auto-approved via domain)</div>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 border border-emerald-200 rounded">Auto</span>
              </button>

              <button
                type="button"
                onClick={() => handleGoogleLogin("contractor@external.com", "External Contractor")}
                className="w-full text-left p-3 border rounded-md hover:bg-muted/50 transition-colors flex justify-between items-center"
              >
                <div>
                  <div className="font-semibold text-sm">Sign in with External Account</div>
                  <div className="text-xs text-muted-foreground">contractor@external.com (Awaiting Approval)</div>
                </div>
                <span className="text-[10px] bg-amber-50 text-amber-600 font-semibold px-2 py-0.5 border border-amber-200 rounded">Pending</span>
              </button>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Or sign in with custom account:</div>
              <div>
                <Label className="text-xs">Full Name</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Alice Smith"
                  value={customGoogleName}
                  onChange={(e) => setCustomGoogleName(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Email Address</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. alice@gmail.com"
                  value={customGoogleEmail}
                  onChange={(e) => setCustomGoogleEmail(e.target.value)}
                />
              </div>
              <Button
                className="w-full mt-2"
                onClick={() => handleGoogleLogin(customGoogleEmail, customGoogleName)}
                disabled={!customGoogleEmail}
              >
                Sign In with Custom Email
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setShowGoogleMock(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">or</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
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
              autoFocus
              placeholder="you@example.com"
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
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
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
