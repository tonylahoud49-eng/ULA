import React, { useEffect, useId, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { brainRequest } from "@/api/brainClient";
import ApprovedReportUpload from "@/components/ApprovedReportUpload";
const post = (id, action, values = {}) => brainRequest(`/reports/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });

function ReportReview({ report, busy, canReview, act }) {
  const [verification, setVerification] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState((report.knowledge_manifest?.style_notes || report.style_notes || []).join("\n\n"));
  const [confirmed, setConfirmed] = useState(false);
  const [remove, setRemove] = useState(false);
  const learned = Boolean(report.learned_at && report.style_notes?.length);
  const status = report.approval_status === "submitted" ? "Awaiting verification of final approval"
    : report.approval_status === "rejected" ? "Ineligible for knowledge"
      : ({ uploaded: "Verified final report · ready to digest", pending: "Methodology awaiting review", active: "Active knowledge", removed: "Knowledge removed · original retained", learning: "Digesting final report", failed: "Digestion needs attention" }[report.status] || "Legacy submission · upload with approval details");
  const change = (action, values = {}, label = "Updating report…") => act(() => post(report.id, action, { revision: report.revision || 0, ...values }), label);
  return <article className="py-4 space-y-3 min-w-0">
    <div className="flex flex-wrap justify-between gap-2">
      <div className="min-w-0"><h4 className="font-medium break-words">{report.report_title || report.file_name}</h4><p className="text-sm text-muted-foreground">{status}</p></div>
      <a href={`/api/ai/brain/reports/${report.id}/file`} className="text-sm underline underline-offset-4">Download original</a>
    </div>
    <p className="text-sm text-muted-foreground break-words">{report.claim_case_id || "Case reference not supplied"}</p>
    <details className="text-sm">
      <summary className="cursor-pointer">Source and approval details</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr] break-words">
        <dt>Source file</dt><dd>{report.file_name}</dd>
        <dt>Business line</dt><dd>{report.business_line}</dd>
        <dt>Loss topic</dt><dd>{report.topic || "Topic not supplied"}</dd>
        <dt>Uploaded by</dt><dd>{report.uploader_name || report.uploaded_by}</dd>
        <dt>Uploaded</dt><dd>{new Date(report.created_at).toLocaleString()}</dd>
        <dt>Human approval</dt><dd>{report.approved_by || "Not recorded"} · {report.approval_date || "No date"}</dd>
        <dt>Library reference</dt><dd className="break-all">{report.id}</dd>
        {report.verification_note && <><dt>Verification</dt><dd>{report.verification_note}</dd></>}
        {report.rejection_reason && <><dt>Reason ineligible</dt><dd>{report.rejection_reason}</dd></>}
      </dl>
    </details>
    {report.error && <p className="text-sm text-destructive break-words">{report.error}</p>}
    {canReview && report.approval_status === "submitted" && <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault(); change("verify-approval", { confirmed: true, verification_note: verification }, "Verifying final approval…");
    }}>
      <p className="text-sm max-w-prose">Inspect the original and its approval record. Verification records an existing professional approval; it does not approve a draft.</p>
      <label className="block space-y-1 text-sm">How was final approval verified?
        <Input required minLength={10} maxLength={1000} value={verification} disabled={busy} onChange={(event) => setVerification(event.target.value)} placeholder="Signed final report or approval correspondence" />
      </label>
      <Button size="sm" type="submit" disabled={busy}>Verify existing final approval</Button>
    </form>}
    {canReview && report.approval_status === "verified" && ["uploaded", "failed"].includes(report.status) && !learned && <Button size="sm" disabled={busy} onClick={() => change("learn", {}, "Digesting approved final report… This may take up to two minutes.")}>Digest approved report</Button>}
    {learned && <details className="text-sm">
      <summary className="cursor-pointer">Review reusable methodology ({report.style_notes.length} suggestions)</summary>
      {canReview && report.approval_status === "verified" && ["pending", "removed", "active"].includes(report.status) ? <form className="mt-3 space-y-3" onSubmit={(event) => {
        event.preventDefault(); change("activate", { style_notes: notes.split(/\n\s*\n/).map((note) => note.trim()).filter(Boolean), methodology_only: confirmed }, "Saving approved methodology…");
      }}>
        <label className="block space-y-1">Methodology notes · separate each note with a blank line
          <Textarea required rows={8} value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-primary" required checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed these notes against the report specification. They contain only reusable methodology, no confidential or claim-specific information, and may be shared with ULA staff.</span></label>
        <Button size="sm" type="submit" disabled={busy || !confirmed}>Approve and activate methodology</Button>
      </form> : <ul className="mt-3 list-disc pl-5 space-y-2 break-words">{(report.knowledge_manifest?.style_notes || report.style_notes).map((note, index) => <li key={index}>{note}</li>)}</ul>}
    </details>}
    {report.usage && <p className="text-xs text-muted-foreground">Confirmed digestion usage: {report.usage.input_tokens || 0} input tokens · {report.usage.output_tokens || 0} output tokens</p>}
    {canReview && report.status === "learning" && Date.now() - Date.parse(report.learning_started_at) >= 300000 && <div className="space-y-2"><p className="text-sm text-muted-foreground">This attempt may have been interrupted. Resetting permits another attempt; the provider may have billed the interrupted request.</p><Button size="sm" variant="outline" disabled={busy} onClick={() => change("reset")}>Reset interrupted digestion</Button></div>}
    {canReview && report.status === "active" && <div className="flex flex-wrap items-center gap-2">
      {remove ? <><span className="text-sm">Remove from future knowledge retrieval? The original stays saved.</span><Button size="sm" variant="destructive" disabled={busy} onClick={() => change("remove-knowledge")}>Confirm removal</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setRemove(false)}>Cancel</Button></> : <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemove(true)}>Remove from knowledge</Button>}
    </div>}
    {canReview && report.approval_status !== "rejected" && report.status !== "learning" && <details className="text-sm"><summary className="cursor-pointer">Mark this report ineligible</summary><form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); change("reject", { reason }); }}><label className="flex-1 space-y-1">Reason<Input required maxLength={1000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label><Button size="sm" type="submit" variant="outline" disabled={busy}>Mark ineligible</Button></form></details>}
  </article>;
}

export default function BrainKnowledgeLibrary() {
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bank, setBank] = useState([]);
  const [reports, setReports] = useState([]);
  const [businessLines, setBusinessLines] = useState([]);
  const [topics, setTopics] = useState([]);
  const [canReview, setCanReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const panelId = useId();
  const receive = (body) => { setReports(body.reports); setBank(body.bank); setBusinessLines(body.business_lines); setTopics(body.topics); setCanReview(body.can_review); setLoaded(true); };
  const refresh = async () => receive(await brainRequest("/reports"));
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true); setLoaded(false); setProgress("Loading approved report library…"); setError(""); setNotice("");
    brainRequest("/reports").then((body) => { if (active) receive(body); })
      .catch((cause) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open]);
  const act = async (action, label = "Updating library…") => {
    if (busy) return;
    setBusy(true); setProgress(label); setError(""); setNotice("");
    try {
      const result = await action();
      setNotice(result?.reused ? "Saved methodology reused; no new digestion request was made." : "Saved.");
      try { await refresh(); }
      catch (cause) { setError(`The action completed, but the library could not refresh: ${cause.message}`); }
    } catch (cause) { setNotice(""); setError(cause.message); }
    finally { setBusy(false); }
  };
  const preview = [...new Set(bank.flatMap((item) => item.preview))];
  return <div className="space-y-4">
    <Button type="button" variant="outline" disabled={busy} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <Brain className="h-4 w-4" aria-hidden="true" />{open ? "Close Brain" : "Open Brain"}
    </Button>
    {open && <section id={panelId} className="rounded-md border border-border bg-background" aria-label="Brain bank">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div><h3 className="font-heading text-lg">Brain bank</h3>{loaded && <p className="text-sm text-muted-foreground">{bank.reduce((count, item) => count + item.active_reports, 0)} approved references · {bank.reduce((count, item) => count + item.methodology_notes, 0)} methodology notes</p>}</div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); setProgress("Refreshing Brain bank…"); setError(""); setNotice(""); try { await refresh(); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }}>Refresh</Button>
          <Button type="button" size="sm" disabled={busy || !loaded} aria-expanded={uploadOpen} aria-controls={`${panelId}-upload`} onClick={() => setUploadOpen(!uploadOpen)}>{uploadOpen ? "Close upload" : "Upload approved report"}</Button>
        </div>
      </div>
      <div className="space-y-4 p-4" aria-busy={busy}>
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{progress}</p>}
        {loaded && <>
          {uploadOpen && <div id={`${panelId}-upload`}><ApprovedReportUpload businessLines={businessLines} topics={topics} disabled={busy} onBusyChange={(value) => { setBusy(value); if (value) setProgress("Saving approved report…"); }} onSaved={async () => {
            try { await refresh(); }
            catch (cause) { setError(`The report was saved, but the Brain could not refresh: ${cause.message}`); }
          }} /></div>}
          {preview.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-medium">View approved methodology preview</summary><ul className="mt-3 list-disc space-y-2 pl-5 break-words">{preview.map((note) => <li key={note}>{note}</li>)}</ul></details>}
          <div>
            <h4 className="font-medium">Report submissions</h4>
            {!reports.length && <p className="mt-2 text-sm text-muted-foreground">No submissions available to your account. Upload an approved final report here or from its signed report version.</p>}
            <div className="divide-y divide-border">{reports.map((report) => <ReportReview key={`${report.id}:${report.revision || 0}`} report={report} busy={busy} canReview={canReview} act={act} />)}</div>
          </div>
        </>}
      </div>
    </section>}
  </div>;
}
