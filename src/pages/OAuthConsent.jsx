import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function OAuthConsent() {
  const ctx = new URLSearchParams(window.location.search).get("ctx");
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [decided, setDecided] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let redirecting = false;

    const loadConsent = async () => {
      try {
        const data = await appClient.consent.getInfo(ctx);
        if (!active) return;
        if (!data.authenticated) {
          const returnTo = `${window.location.pathname}?ctx=${encodeURIComponent(ctx)}`;
          redirecting = true;
          window.location.href = `${data.login_path || "/login"}?returnTo=${encodeURIComponent(returnTo)}`;
          return;
        }
        setInfo(data);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load this authorization request.");
      } finally {
        if (active && !redirecting) setChecking(false);
      }
    };

    loadConsent();
    return () => {
      active = false;
    };
  }, [ctx]);

  const respond = async (action) => {
    setSubmitting(true);
    setError("");
    try {
      await appClient.consent.respond(ctx, action);
      setDecided(action);
    } catch (responseError) {
      setError(responseError.message || "Could not complete authorization.");
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <AuthLayout icon={ShieldCheck} title="Authorize access">
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      </AuthLayout>
    );
  }

  const client = info?.client_name || "An AI client";
  const appName = info?.app_name || "this app";

  if (decided) {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title={decided === "approve" ? "Access granted" : "Access denied"}
        subtitle={`You can return to ${client} and close this window.`}
      />
    );
  }

  if (error && !info) {
    return (
      <AuthLayout icon={ShieldCheck} title="Authorize access">
        <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      </AuthLayout>
    );
  }

  const tools = Array.isArray(info?.tools) ? info.tools : [];

  return (
    <AuthLayout
      icon={ShieldCheck}
      title="Authorize access"
      subtitle={`${client} wants to access ${appName} on your behalf`}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <p className="text-sm font-medium text-foreground mb-2">
        {tools.length ? `It will be able to use these tools in ${appName}:` : "No tools requested"}
      </p>
      {tools.length > 0 && (
        <ul className="space-y-2 text-sm mb-6">
          {tools.map((tool) => (
            <li key={tool.name} className="flex flex-col">
              <span className="text-foreground font-medium">{tool.title || tool.name}</span>
              {tool.description && <span className="text-muted-foreground">{tool.description}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 h-12 font-medium"
          disabled={submitting}
          onClick={() => respond("deny")}
        >
          Deny
        </Button>
        <Button
          className="flex-1 h-12 font-medium"
          disabled={submitting}
          onClick={() => respond("approve")}
        >
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Approve
        </Button>
      </div>
    </AuthLayout>
  );
}
