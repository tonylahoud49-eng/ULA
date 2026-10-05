# Resumable claim analysis

## Rollback checkpoint

The pre-change source is preserved at Git branch `checkpoint/pre-resumable-analysis-20261005-114248`, commit `2d230b238504b3c840d37ec25f79831cbdb4cdee`.

Local archives are in `C:\Users\user\Desktop\ULA-checkpoints\20261005-114248`: `app-source.zip` contains tracked application source; `untracked-agency-docs.zip` preserves the existing untracked agency documents. These are source checkpoints, not backups of production PostgreSQL, secrets, uploads, or runtime data.

To inspect or rebuild the old application without overwriting current work:

```powershell
git worktree add C:\Users\user\Desktop\ULA-before-resumable checkpoint/pre-resumable-analysis-20261005-114248
Set-Location C:\Users\user\Desktop\ULA-before-resumable
npm ci
npm run build
```

For a production rollback, stop the application service, deploy a build of the checkpoint using the normal deployment procedure, retain the existing `.env`, PostgreSQL database and `.data`, then restart the service. Do not delete the job directory. This change adds no database migration. Existing incomplete provisional drafts must remain drafts after rollback; the previous application does not understand the new partial-review exception. Avoid issuing those drafts with an older build.

## Deployment

Deploy the backend and rebuilt frontend together. Follow `WINDOWS_PRODUCTION_DEPLOYMENT.md`, including the production build environment and production checks. The normal Claude provider settings are reused. Other providers retain their existing analysis workflow.

- `AI_JOB_STORAGE_DIR` defaults to `.data/analysis-jobs` in the installation. Use a persistent local directory writable only by the application service and administrators. Include it in the normal encrypted evidence backup and retention process. It contains claim evidence, intermediate analysis, results and discussion history.
- `AI_JOB_MAX_PAGES` defaults to 2,000 per PDF. The existing file-count and upload-byte limits still apply. Large uploads remain subject to proxy limits.
- `AI_JOB_REQUEST_TIMEOUT_MS` defaults to 300,000 milliseconds per provider attempt and is capped at five minutes even when the environment sets a larger value. With three total attempts and two brief backoffs, a single batch stops within about 15 minutes.
- `AI_JOB_IDLE_TIMEOUT_MS` defaults to 120,000 milliseconds without response data, including connection setup. A silent request is aborted and receives the existing bounded retries. Stream activity does not extend the total request deadline.
- `AI_JOB_BATCH_MAX_PAGES` defaults to 20 (maximum 20). Review batches are bounded by page count as well as token/image/byte budgets, so a 40-page claim cannot wait for one giant review checkpoint. Non-PDF evidence counts as at least one page. On resume, oversized unfinished batches from older releases are split; saved reviews are reused.
- Run one analysis worker process per installation. A local PID lock prevents duplicate execution of the same job across processes on the same host; distributed workers and shared multi-host volumes are not supported by this implementation.
- Extraction settings are read at execution time. The legacy PDF limits remain available; the new job path uses bounded ranges of at most 20 PDF pages and does not send an oversized original PDF to the provider.

The browser submits a job and polls saved status. Closing the browser does not cancel work. After a process restart, interrupted jobs display **Retry unfinished stage**; the user explicitly resumes them. Successful checkpoints are reused, including when a previous response was lost before the browser received it. An interrupted provider request itself can need repeating, with uncertain provider billing. Usage totals account for successfully saved responses; they are not a billing guarantee for failed requests.

Jobs are private to their submitting user and require current claim access in production. Resume and result application reject changed attachment identities or storage references. New requests are fingerprinted from claim context, original file contents, model/output settings, methodology snapshot and pipeline version. An old completed analysis is never silently applied over new evidence.

## Large files and errors

During each provider attempt, the workspace shows elapsed time, attempt number, the total request deadline and the last received connection activity. Stream activity is saved at bounded intervals without exposing generated text or private reasoning. Only completed, validated review batches advance the page counter. Status polling times out after 30 seconds and reports a connection error instead of leaving a silently frozen poll.

The server extracts every PDF page in original order and retains the original document and page numbers. It groups extraction checkpoints according to conservative token/image/byte budgets. If one request exceeds capacity, only that unfinished group is split. Image-request errors receive a single image re-encoding attempt before smaller page ranges are tried. Unreadable individual pages remain explicit failures, not silently excluded evidence.

Saved review batches are intermediate evidence ledgers. When more than one batch is needed, a separate reconciliation call reviews those ledgers together and performs the Director review. Final citations are checked against reviewed document/page identities; synthesis cannot introduce new visual citations. If the accumulated ledgers themselves exceed the reconciliation budget, reconciliation stops with saved batches intact rather than truncating evidence. This version does not provide unlimited-size analysis or hierarchical reconciliation.

When a job has stopped after at least one completed review, **Use completed review for provisional draft** creates and saves a provisional reconciliation of the completed batches. The exact unreviewed PDF pages and non-PDF attachments are listed in the draft's evidence gaps. Final approval, final issue and final DOCX/PDF export remain blocked. Completing a later retry requires loading the completed analysis and generating a new draft; it does not clear blockers on an existing provisional draft.

## Discussion

**Discuss analysis** opens a persistent conversation about a completed or explicitly prepared provisional analysis. The assistant uses that saved analysis and its verified source registry. Users can inspect cited filenames, pages and excerpts. The assistant cannot change the claim, report, financial calculations or approval state. New assertions supplied in chat are not evidence. Each answer is a provider request; duplicate retries of an already saved answer reuse the saved response. Conversation history is scoped to the analysis job.

## Verification

`server/tests/analysis-jobs.test.mjs` covers 180-page extraction, batch checkpointing, image failures, partial drafts and final-issue blocking, restart recovery, bounded retries, duplicate submissions, changed file contents, owner isolation, source-page checks, persisted discussion and invented-citation rejection. Provider calls in these tests are mocked; the real 180-page PDF parsing test runs locally without an API call.
