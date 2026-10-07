import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, Loader2, MessageSquare, RotateCcw, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { analysisJobRequest } from "@/api/aiAnalysisClient";
import { analysisWorkspaceJobPath } from "@/lib/analysisWorkspaceJob";

const duration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};

export default function AnalysisWorkspace({ claimId, analysis, activeJobId, onSelectSaved, onLoad, busy = false }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatProvisional, setChatProvisional] = useState(false);
  const retryRequest = useRef(null);
  const mountedClaim = useRef(claimId);
  mountedClaim.current = claimId;
  const jobPath = analysisWorkspaceJobPath(claimId, analysis, activeJobId);

  const running = ["queued", "running"].includes(job?.state);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    let active = true, timer;
    const selectedJobId = activeJobId || analysis?.job_id;
    setJob(null); setError(""); setChatOpen(false); setMessages([]); setQuestion(""); setChatError("");
    const poll = async () => {
      let keepPolling = true;
      try {
        const data = await analysisJobRequest(jobPath);
        if (active) { setJob(data.job); setError(""); }
        keepPolling = !selectedJobId || ["queued", "running"].includes(data.job?.state);
      } catch (failure) { if (active) setError(`Saved progress could not be refreshed. ${failure.message}`); }
      if (active && keepPolling) timer = setTimeout(poll, 3000);
    };
    // Legacy saved analyses have no job. Showing the claim's latest job beside
    // one of these would attach an unrelated run to the selected analysis.
    if (jobPath) poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobPath, busy]);

  const displayedAnalysis = !activeJobId || analysis?.job_id === activeJobId ? analysis : null;
  const chatJobId = displayedAnalysis?.job_id || (job?.state === "complete" ? job.id : null);
  useEffect(() => {
    let active = true;
    if (chatOpen && chatJobId) {
      setMessages([]); setChatError("");
      analysisJobRequest(`/api/ai/jobs/${chatJobId}/chat`).then((data) => {
        if (active) { setMessages(data.messages); setChatProvisional(data.provisional === true); }
      }).catch((failure) => { if (active) setChatError(failure.message); });
    }
    return () => { active = false; };
  }, [chatOpen, chatJobId, job?.state, analysis?.response_id]);

  const resume = async () => {
    const originalClaim = claimId;
    setActing(true); setError("");
    try {
      const data = await analysisJobRequest(`/api/ai/jobs/${job.id}/resume`, { method: "POST" });
      if (mountedClaim.current !== originalClaim) return;
      setJob(data.job);
      await onLoad(job.id, false);
    } catch (failure) { if (mountedClaim.current === originalClaim) setError(failure.message); }
    finally { if (mountedClaim.current === originalClaim) setActing(false); }
  };
  const send = async (event) => {
    event.preventDefault();
    if (!question.trim() || sending) return;
    const originalClaim = claimId;
    const message = question.trim();
    if (retryRequest.current?.message !== message || retryRequest.current?.job !== chatJobId) retryRequest.current = { message, job: chatJobId, request_id: crypto.randomUUID() };
    setSending(true); setChatError("");
    try {
      const data = await analysisJobRequest(`/api/ai/jobs/${chatJobId}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(retryRequest.current) });
      if (mountedClaim.current !== originalClaim) return;
      setMessages(data.messages); setQuestion(""); retryRequest.current = null;
    } catch (failure) { if (mountedClaim.current === originalClaim) setChatError(failure.message); }
    finally { if (mountedClaim.current === originalClaim) setSending(false); }
  };
  if (!job && !chatJobId && !error && !displayedAnalysis?.methodology_references?.length) return null;
  const stopped = ["failed", "interrupted"].includes(job?.state);
  const canUsePartialReview = stopped && job.completed_batches > 0 && job.completed_batches < job.total_batches;
  const request = running ? job?.request_progress : null;
  const phases = ["extracting", "reviewing", "synthesizing", "complete"];
  const phaseIndex = phases.indexOf(job?.phase);
  const count = job?.total_pages ? `${job.reviewed_pages} of ${job.total_pages} PDF pages reviewed` : `${job?.completed_batches || 0} of ${job?.total_batches || 0} review batches saved`;
  const percent = job?.total_pages ? Math.round(job.reviewed_pages / job.total_pages * 100) : job?.total_batches ? Math.round(job.completed_batches / job.total_batches * 100) : 0;
  return (
    <section className="docket-surface overflow-hidden rounded-lg border border-border" aria-label="Saved analysis and discussion">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-xl font-semibold">
            {running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : stopped ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-primary" />}
            {stopped ? "Analysis needs attention" : running ? "Analysis in progress" : "Saved analysis"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{job ? count : "Discuss the evidence behind this analysis."}</p>
        </div>
        {chatJobId && <Button variant="outline" size="sm" aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}><MessageSquare className="mr-2 h-4 w-4" />{chatOpen ? "Close discussion" : "Discuss analysis"}</Button>}
        {activeJobId && analysis && activeJobId !== analysis.job_id && onSelectSaved && <Button variant="outline" size="sm" disabled={busy || acting} onClick={onSelectSaved}>View previous saved analysis</Button>}
      </div>
      {job && <div className="space-y-4 px-5 py-4">
        <ol className="grid gap-2 text-sm sm:grid-cols-4" aria-label="Analysis stages">
          {["Extract evidence", "Review batches", "Reconcile claim", "Ready for review"].map((label, index) => <li key={label} className={`flex items-center gap-2 ${index <= phaseIndex ? "text-foreground" : "text-muted-foreground"}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${index < phaseIndex || job.state === "complete" ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {index < phaseIndex || job.state === "complete" ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>{label}
          </li>)}
        </ol>
        <div role="progressbar" aria-label="Evidence review completed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={count} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div>
        <p className="break-words text-sm" role="status">{job.message}</p>
        {request && <div className="space-y-1 text-sm text-muted-foreground">
          <p className="tabular-nums">{request.label} · Attempt {request.attempt} of {request.max_attempts} · Elapsed {duration(clock - Date.parse(request.started_at))}</p>
          <p>{request.last_activity_at
            ? `Last AI connection activity: ${new Date(request.last_activity_at).toLocaleTimeString()}.`
            : "Waiting for the analysis service to connect."}</p>
          <p>{clock >= Date.parse(request.deadline_at)
            ? "The request deadline has passed. Waiting for the server to confirm the retry or error."
            : `This attempt has up to ${duration(Date.parse(request.deadline_at) - clock)} remaining. A silent connection is retried sooner.`}</p>
        </div>}
        {running && job.phase === "reviewing" && <p className="text-sm text-muted-foreground">The page count increases when a complete batch is checked and saved. A receiving response is not yet a saved review.</p>}
        {!!job.active_batch?.length && running && <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Documents in this batch ({job.active_batch.length})</summary>
          <ul className="mt-2 space-y-1">{job.active_batch.map((item, index) => <li className="break-words" key={index}>{item.document_name}{item.pages.length ? ` · Pages ${item.pages[0]}–${item.pages.at(-1)}` : ""}</li>)}</ul>
        </details>}
        {job.phase === "extracting" && <p className="text-xs text-muted-foreground">{job.extracted_units} of {job.total_units} extraction checkpoints saved.</p>}
        {running && <p className="text-xs text-muted-foreground">You can leave this page. Work continues on the server and completed checkpoints are saved.</p>}
        {job.error && <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" role="alert">
          <p className="text-sm">{job.error.message}</p>
          {job.error.affected?.map((item, index) => <p className="text-xs" key={index}>{item.document_name}{item.pages.length === 1 ? ` · Page ${item.pages[0]}` : item.pages.length ? ` · Pages ${item.pages[0]}–${item.pages.at(-1)}` : ""}</p>)}
          {job.error.details && <details className="text-xs"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 break-words">{job.error.details}</p></details>}
        </div>}
        <div className="flex flex-wrap gap-2">
          {stopped && <Button onClick={resume} disabled={busy || acting}><RotateCcw className="mr-2 h-4 w-4" />{acting ? "Resuming…" : "Retry unfinished stage"}</Button>}
          {canUsePartialReview && <Button variant="outline" onClick={() => onLoad(job.id, true)} disabled={busy || acting}>Use completed review for provisional draft</Button>}
          {job.state === "complete" && (analysis?.job_id !== job.id || analysis?.provisional) && <Button onClick={() => onLoad(job.id, false)} disabled={busy || acting}>Load saved analysis</Button>}
        </div>
        {canUsePartialReview && <p className="text-xs text-muted-foreground">A provisional draft lists unreviewed evidence. Final approval and final export remain blocked until all evidence is reviewed and the draft is regenerated.</p>}
        <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Activity and saved checkpoints</summary><ol className="mt-3 space-y-2">{job.events.slice(-12).map((entry, index) => <li key={index} className="flex gap-3 text-xs"><time className="shrink-0 tabular-nums text-muted-foreground" dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time><span className="break-words">{entry.message}</span></li>)}</ol></details>
      </div>}
      {error && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{error}</p>}
      {!!displayedAnalysis?.methodology_references?.length && <details className="border-t px-5 py-4 text-sm">
        <summary className="cursor-pointer">Approved methodology used ({displayedAnalysis.methodology_references.length})</summary>
        <p className="mt-2 text-muted-foreground">Internal reference history. These reports guide methodology; current claim evidence supplies all facts. Original files remain available only to their uploader and administrators.</p>
        <ul className="mt-2 space-y-2">{displayedAnalysis.methodology_references.map((reference) => <li key={`${reference.report_id}:${reference.revision}`} className="break-words">{reference.title} · Revision {reference.revision}<span className="block text-xs text-muted-foreground break-all">Library reference: {reference.report_id}</span></li>)}</ul>
      </details>}
      {chatOpen && chatJobId && <div className="border-t px-5 py-4">
        <h3 className="font-heading text-lg font-semibold">Discuss this analysis</h3>
        <p className="mt-1 text-xs text-muted-foreground">Answers use the saved analysis and cited evidence. Suggestions do not change your claim or report. Each answer uses the configured Claude service.</p>
        {chatProvisional && <p className="mt-2 text-xs text-destructive">This discussion uses an incomplete provisional review. Unreviewed pages are not evidence.</p>}
        <div className="my-4 max-h-[28rem] space-y-4 overflow-y-auto" role="log" aria-label="Analysis discussion" aria-live="polite">
          {!messages.length && <p className="py-2 text-sm text-muted-foreground">Ask what supports a finding, which evidence is missing, or why two documents conflict.</p>}
          {messages.map((message, index) => <article key={`${message.request_id}-${index}`} className="border-b pb-4 last:border-0">
            <p className="mb-1 text-xs font-semibold">{message.role === "user" ? "You" : "Analysis assistant"}</p>
            <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert"><ReactMarkdown>{message.content}</ReactMarkdown></div>
            {message.sources?.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">View cited evidence ({message.sources.length})</summary><ul className="mt-2 space-y-2">{message.sources.map((source) => <li key={source.citation_id}><strong>[{source.citation_id}] {source.document_name}{source.page ? ` · Page ${source.page}` : ""}</strong><blockquote className="mt-1 text-muted-foreground">{source.supporting_text}</blockquote></li>)}</ul></details>}
          </article>)}
          {sending && <p role="status" className="text-sm text-muted-foreground">Preparing an evidence-based answer…</p>}
        </div>
        <form onSubmit={send} className="space-y-2">
          <label htmlFor={`analysis-question-${claimId}`} className="text-sm font-medium">Your question</label>
          <Textarea id={`analysis-question-${claimId}`} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={6000} rows={3} placeholder="What evidence supports the cause-of-loss opinion?" disabled={sending} />
          {chatError && <p role="alert" className="text-sm text-destructive">{chatError}</p>}
          <Button type="submit" disabled={sending || !question.trim()}><Send className="mr-2 h-4 w-4" />{sending ? "Answering…" : "Send question"}</Button>
        </form>
      </div>}
    </section>
  );
}
