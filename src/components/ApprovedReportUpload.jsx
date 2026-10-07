import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brainRequest } from "@/api/brainClient";

export default function ApprovedReportUpload({ businessLine, businessLines: suppliedBusinessLines, report, topics: suppliedTopics, disabled = false, onSaved, onBusyChange }) {
  const [topics, setTopics] = useState(suppliedTopics || []);
  const [businessLines, setBusinessLines] = useState(suppliedBusinessLines || []);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (suppliedTopics) setTopics(suppliedTopics);
    if (suppliedBusinessLines) setBusinessLines(suppliedBusinessLines);
    if (suppliedTopics && (businessLine || suppliedBusinessLines)) return;
    let active = true;
    setConfigLoading(true); setConfigError("");
    brainRequest("/config").then((body) => { if (active) { setTopics(body.topics); setBusinessLines(body.business_lines); } })
      .catch((cause) => { if (active) setConfigError(cause.message); })
      .finally(() => { if (active) setConfigLoading(false); });
    return () => { active = false; };
  }, [suppliedTopics, suppliedBusinessLines, businessLine, configAttempt]);
  const busy = disabled || saving;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{report ? "Upload the signed final file for this version. It is automatically submitted for verification and methodology review." : "Upload an already approved final report. Its original is retained; methodology becomes available after review."}</p>
    {configLoading && <p role="status" className="text-sm text-muted-foreground">Loading loss topics…</p>}
    {configError && <div className="space-y-2"><p role="alert" className="text-sm text-destructive break-words">Loss topics could not be loaded. {configError}</p><Button type="button" size="sm" variant="outline" disabled={busy || configLoading} onClick={() => setConfigAttempt((value) => value + 1)}>Retry loss topics</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {saved && <p role="status" className="text-sm text-primary">Final report saved in the Brain bank. {saved.approval_status === "submitted" ? "Awaiting verification and methodology review." : "Existing submission reused."}</p>}
    <form className="grid gap-3 sm:grid-cols-2" aria-busy={saving} onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget);
      if (businessLine) data.set("business_line", businessLine);
      data.set("report_status", "final");
      if (report) data.set("report_version_id", report.id);
      setSaving(true); setError(""); setSaved(null);
      onBusyChange?.(true);
      try { const result = await brainRequest("/reports", { method: "POST", body: data }); setSaved(result); await onSaved?.(result); }
      catch (cause) { setError(cause.message); }
      finally { setSaving(false); onBusyChange?.(false); }
    }}>
      {!report && <>
        <label className="space-y-1 text-sm">Claim / case reference<Input name="claim_case_id" required maxLength={200} disabled={busy} /></label>
        <label className="space-y-1 text-sm">Report title<Input name="report_title" required maxLength={200} disabled={busy} /></label>
        <label className="space-y-1 text-sm">Approved by<Input name="approved_by" required maxLength={200} disabled={busy} /></label>
        <label className="space-y-1 text-sm">Approval date<Input name="approval_date" type="date" required disabled={busy} /></label>
      </>}
      {!businessLine && <label className="space-y-1 text-sm sm:col-span-2">Report business line<select name="business_line" required disabled={busy || !businessLines.length} defaultValue="" className="w-full h-10 border border-input rounded-md bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Select report business line</option>{businessLines.map((value) => <option key={value}>{value}</option>)}</select></label>}
      <label className="space-y-1 text-sm sm:col-span-2">Loss topic<select name="topic" required disabled={busy || !topics.length} defaultValue="" className="w-full h-10 border border-input rounded-md bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Select loss topic</option>{topics.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="space-y-1 text-sm sm:col-span-2">Original approved final report<Input name="file" required type="file" accept=".pdf,.docx,.txt" disabled={busy} /></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">PDF, DOCX, or text; maximum 25 MB. Digestion requires 50–150,000 readable characters across the complete report.</p>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input name="approved_confirmation" value="true" type="checkbox" required disabled={busy} className="mt-1 accent-primary" /><span>{report ? "This file is the approved, signed final report for this version." : "This is the final report already approved by the professional named above. It is not a draft, unapproved, or rejected report."}</span></label>
      <Button type="submit" disabled={busy || !topics.length} className="justify-self-start">{saving ? "Saving final report…" : "Upload final report to Brain"}</Button>
    </form>
  </div>;
}
