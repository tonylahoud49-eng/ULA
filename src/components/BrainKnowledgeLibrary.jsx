import React, { useEffect, useState } from "react";
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
    <p className="text-sm text-muted-foreground break-words">{report.claim_case_id || "Case reference not supplied"} · {report.business_line} · {report.topic || "Topic not supplied"}</p>
    <details className="text-sm">
      <summary className="cursor-pointer">Source and approval details</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr] break-words">
        <dt>Source file</dt><dd>{report.file_name}</dd>
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
  const [selectedLine, setSelectedLine] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bank, setBank] = useState([]);
  const [reports, setReports] = useState([]);
  const [topics, setTopics] = useState([]);
  const [canReview, setCanReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const receive = (body) => { setReports(body.reports); setBank(body.bank); setTopics(body.topics); setCanReview(body.can_review); setLoaded(true); };
  const refresh = async () => receive(await brainRequest("/reports"));
  useEffect(() => {
    let active = true;
    setBusy(true); setProgress("Loading approved report library…"); setError("");
    brainRequest("/reports").then((body) => { if (active) receive(body); })
      .catch((cause) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
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
  return <section className="border border-border rounded-md bg-background">
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="flex items-center gap-2 font-heading text-lg"><Brain className="h-4 w-4 text-primary" aria-hidden="true" />Brain bank</h3><p className="text-sm text-muted-foreground">{loaded ? `${bank.reduce((count, item) => count + item.active_reports, 0)} approved references across ${bank.length} business-line Brains` : "Loading Brain bank…"}</p></div>
      <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); setProgress("Refreshing Brain bank…"); setError(""); setNotice(""); try { await refresh(); } catch (cause) { setError(cause.message); } finally { setBusy(false); } }}>Refresh bank</Button>
    </div>
    <div className="border-t border-border px-4" aria-busy={busy}>
      {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {busy && <p role="status" className="flex items-center gap-2 py-3 text-sm"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{progress}</p>}
      <div className="divide-y divide-border">{bank.map((item) => {
        const expanded = selectedLine === item.business_line;
        const ownedReports = reports.filter((report) => report.business_line === item.business_line);
        const panelId = `brain-${item.business_line.replace(/[^a-zA-Z0-9]/g, "-")}`;
        return <div key={item.business_line}>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0"><h4 className="font-medium">{item.business_line}</h4><p className="text-xs text-muted-foreground">{item.active_reports} active references · {item.methodology_notes} methodology notes{item.awaiting_review ? ` · ${item.awaiting_review} awaiting review` : ""}</p>{item.preview[0] && <p className="mt-1 max-w-prose line-clamp-1 break-words text-sm text-muted-foreground">{item.preview[0]}</p>}</div>
            <Button variant="outline" size="sm" disabled={busy} aria-expanded={expanded} aria-controls={panelId} onClick={() => { setSelectedLine(expanded ? "" : item.business_line); setUploadOpen(false); }}>{expanded ? "Close Brain" : "Open Brain"}</Button>
          </div>
          {expanded && <div id={panelId} className="space-y-4 border-t border-border py-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Approved methodology for {item.business_line}</p><Button size="sm" disabled={busy} aria-expanded={uploadOpen} onClick={() => setUploadOpen(!uploadOpen)}>{uploadOpen ? "Close upload" : "Upload approved report"}</Button></div>
            {item.preview.length > 0 && <ul className="list-disc pl-5 space-y-2 text-sm break-words">{item.preview.map((note, index) => <li key={index}>{note}</li>)}</ul>}
            {uploadOpen && <ApprovedReportUpload businessLine={item.business_line} topics={topics} disabled={busy} onBusyChange={(value) => { setBusy(value); if (value) setProgress("Saving approved report…"); }} onSaved={async () => {
              try { await refresh(); }
              catch (cause) { setError(`The report was saved, but the Brain could not refresh: ${cause.message}`); }
            }} />}
            {!ownedReports.length && <p className="text-sm text-muted-foreground">No submissions available to your account in this Brain. Upload an approved final report here or from its signed report version.</p>}
            <div className="divide-y divide-border">{ownedReports.map((report) => <ReportReview key={`${report.id}:${report.revision || 0}`} report={report} busy={busy} canReview={canReview} act={act} />)}</div>
          </div>}
        </div>;
      })}</div>
    </div>
  </section>;
}
