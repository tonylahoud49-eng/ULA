# Approved Report → AI Knowledge Brain

This adds a controlled knowledge library to the existing AI Reporting page. It uses the current authentication, PostgreSQL repository, document extraction, approved-reference layer, and analysis workflows. It does not replace the provider/model configuration, API keys, ports, Run AI Analysis controls, resumable agent, deterministic report calculations, or export rules.

## Upload and approval workflow

1. On the claim's **Reports** tab, the independent **Final report → Upload final report** action appears above the generated versions, including when no version exists or every version is a draft. Employees upload the professionally edited, approved and signed final file with its own title, approving professional and approval date. The form fills in the current claim reference and defaults the business line when supported; an unclassified claim requires a supported report business line. The uploaded file may differ from all generated versions. Upload submits the original to the Brain review queue under the claim reference without sending a generated-version ID, approving a generated draft, replacing a version, or changing claim-analysis evidence. Alternatively, **AI Reporting → Open Brain → Upload approved report** accepts older approved reports with manually supplied case details. **Open Brain** stays closed and makes no library request until opened; its inspector has one ungrouped submission list and an approved methodology preview. Business line is upload metadata, not navigation. Employees confirm that the file is already approved and final; explicit draft/unapproved/rejected submissions remain rejected. Upload does not activate unreviewed knowledge. This workflow uses the existing standalone-upload endpoint and needs no new migration.
2. The original is saved with a SHA-256 hash, upload time, and server-authenticated uploader identity. File contents and source metadata cannot be edited. Identical uploads for the same uploader/case/line/topic reuse the record. Changing or correcting a source requires a new submission; a changed file never overwrites the old one.
3. An administrator checks the original against its signed approval or approval correspondence and records how existing final approval was verified. The system cannot infer genuine professional approval from a filename or checkbox. Submitted or legacy unverified reports cannot be digested.
4. **Digest approved report** extracts the complete readable text and uses a dedicated Claude structured-output request to suggest generic methodology. No claim-analysis request is used for digestion. The extracted text is private. Successful results and provider usage are retained, and retrying a successfully digested report makes no additional provider call.
5. The administrator edits and reviews the suggestions against `docs/REPORT_SPEC.md`, removes confidential/claim-specific content, and explicitly confirms suitability for sharing with ULA staff. **Approve and activate methodology** creates the trusted JSON reference manifest. Unreviewed suggestions remain inactive.
6. **Remove from knowledge** withdraws the active manifest while preserving the original. **Mark ineligible** also withdraws knowledge and blocks further digestion. There is no file-deletion action in this library.

Accepted files are at most 25 MB, with 50–150,000 readable characters in the complete report. Every extracted page must contain readable text. Scanned or longer reports are rejected for digestion with an explanation; no partial report is silently learned. An interrupted attempt can be reset after five minutes. A reset does not automatically call the provider. Billing for an interrupted provider request can be uncertain.

## Retrieval and use

Only active, explicitly approved generic methodology is made available to the existing reference layer. Candidate retrieval requires the same specific business line. The provider prompt further requires matching loss-topic words in current evidence and the existing approved business-line applicability gate. The GFS client/evidence restriction remains in place. Unclassified claims receive no learned methodology. At most three relevant manifests are selected deterministically per request.

The model sees generic methodology and style instructions. It never receives raw historical reports, private extracted text, source report titles, case IDs, parties, amounts, policy terms, or historical claim conclusions as new-claim context. Current uploaded claim evidence remains the sole source of factual citations. Approved methodology supplements the existing Director rules and cannot replace them. This is controlled retrieval, not fine-tuning or an autonomous prompt-rewriting agent.

Analysis results retain an internal list of generic reference titles, library IDs and approved revisions used in their completed review requests. This appears under **Approved methodology used** in the saved-analysis workspace; private source details remain in the permission-controlled library. These references are not printed in client reports.

New analysis requests include the knowledge snapshot in cache identity. Activating, revising, rejecting, or removing applicable knowledge changes the new-request snapshot. Existing saved jobs retain their original snapshot and completed paid work for reproducibility; removing knowledge does not erase historical reference use or change an existing report.

## Security and storage

- `ula.brain_reports`: immutable original bytes, source metadata, approval verification, private extracted text, digestion state and suggestions. Row-level security permits original access only to the uploader and administrators. Employees can submit; administrators alone can verify, digest, activate, reject and remove knowledge.
- `ula.brain_knowledge`: the active, approved, generic methodology projection. Authenticated staff may retrieve it; only administrators can modify it. Updating report state and this projection happens in one database transaction under a row lock.
- No DELETE policy exists for originals. A database trigger prevents source-file and source-metadata modification. Application routes also reject deletion and protect immutable fields.
- Approval/activation/removal transitions record actor/time/revision. PostgreSQL audit entries record the transitions without copying the source document into the audit log. Stale review forms cannot overwrite a later decision.
- Automatic checks reject numbers, currencies, contact details and known source identifiers in activated notes. Human review remains necessary to identify names, sensitive context, unsupported historical findings, and conflicting methodology that mechanical checks cannot recognize.
- Local development uses `.data/brain-reports` and the existing development-only server access convention. It is a single-process adapter. Production requires PostgreSQL and authenticated server sessions.

## Deployment

1. Back up PostgreSQL and persistent `.data` storage.
2. Apply migrations with the existing migration credentials: `npm run db:migrate`. Migration `005_brain_reports.sql` creates the original store; `006_brain_approved_knowledge.sql` adds employee submission policies, immutable originals and the approved knowledge projection. Existing prototype uploads stay unverified.
3. Keep current provider/model/key configuration. Digestion uses the existing `ANTHROPIC_API_KEY` (including the supported legacy alias) and `ANTHROPIC_MODEL`; it does not change any analysis provider selection. Use a structured-output-capable configured Claude model.
4. Run `npm run lint`, `npm run typecheck`, and `npm run build`, then deploy using the existing server process. The production readiness check now includes both Brain tables and their RLS/grants.
5. Verify on the server with employee and administrator accounts: upload an approved final report, check private access, verify existing approval, digest, review/activate, run a relevant claim, inspect reference history, remove knowledge, and download the unchanged original after a restart. These runtime digestion/analysis steps are paid only when explicitly performed in production.

No live server migration or paid provider call was made during development. Database deployment and live browser/provider verification must be completed in the target environment.

## Development verification (7 October 2026)

`npm run lint`, `npm run typecheck`, and `npm run build` pass. Forty-five targeted tests passed for the original feature across the Brain library, saved-analysis jobs and selection, existing server/routes, preflight, legal/reference isolation, report workflow and PostgreSQL readiness. All eleven Brain-library tests passed again for the independent-upload correction. Desktop/mobile Edge checks with mocked endpoints confirmed the collapsed, ungrouped Brain inspector, upload metadata, keyboard reopening, and the independent claim upload with mixed, all-draft and zero generated versions. The final-file form submits its own approval details without a report-version ID or any claim/version mutation; unsupported claim classifications require a supported report business line. Source and screenshot review confirmed placement and mobile fit. Paid API calls = 0. The full test suite was not run. Live PostgreSQL/provider verification was not performed by these local UI checks.

## Caching

The existing Claude endpoint has duplicate-request protection and persistent completed-result reuse. Resumable analysis jobs save extraction and completed paid review batches and reuse them on retry. Claude ephemeral prompt caching is requested and confirmed provider cache usage is recorded; actual live cache hits are not guaranteed by configuration alone. Brain digestion separately reuses saved results. Persistent `.data` storage remains necessary for existing job and analysis-result caches.

## Change map

- Server library: `server/ai/brain/{brainRoutes,brainStore,brainPolicy,brainLearner,brainReferences}.mjs`.
- Database integration: `server/db/postgresRepository.mjs`, migrations `005` and `006`.
- Existing analysis integration: `server/index.mjs`, `server/ai/referenceLayer.mjs`, `server/ai/anthropicPreflight.mjs`, `server/ai/analysisJobRoutes.mjs`, `server/ai/analysisJobs.mjs`.
- UI and history: `src/components/BrainKnowledgeLibrary.jsx`, `src/components/ApprovedReportUpload.jsx`, `src/components/AnalysisWorkspace.jsx`, `src/lib/analysisWorkspaceJob.js`, `src/pages/AIReporting.jsx`, `src/pages/ClaimDetail.jsx`, `src/api/brainClient.js`, `src/api/aiAnalysisClient.js`. The progress panel follows the selected saved analysis's job, or an explicitly started current run; legacy analyses do not inherit an unrelated latest job.
- Specification/documentation: `docs/REPORT_SPEC.md`, this deployment note.
- Targeted tests: `server/tests/brain-library.test.mjs`, `server/tests/analysis-jobs.test.mjs`, `server/tests/analysis-workspace-job.test.mjs`.
