# Analysis progress and latency audit — 8 October 2026

The current workflow has both a visibility problem and avoidable execution overhead. Different accounts analysing different claims share one serial queue. A waiting job displays zero checkpoints because its document inventory has not started. An active job's reviewed-page count advances only after a whole batch is validated and durably saved. That count is truthful, but it does not describe queue wait, extraction, or activity within a request.

This is an audit, not a production change. No application code, report rule, worker setting, live service, or saved job was changed. `REPORT_SPEC.md` was read in full. Its requirements for saved-work progress, complete evidence coverage, provenance, reproducibility and professional approval remain controlling.

## Scope and evidence

- Local source at commit `8ed9261`, compared with the pre-resumable checkpoint and the changes introducing the 20-page cap.
- The user supplied screenshots and confirmed the two PCs use different accounts and different claims.
- Two completed local job records dated 7 October 2026, their saved event timestamps, request usage, and checkpoint sizes. These are not the live 71-page job in the screenshot.
- Read-only local measurements of saved input deserialization and request sizing. No paid provider requests were made.
- Existing worker, transport, and workspace selection tests: **17 passed**.
- Impeccable context and technical audit guidance were used for the progress component. The component detector returned no mechanical findings. Behavioral findings below remain valid despite that result.

No live production logs or comparable pre-change run of the same evidence were available. The audit establishes overhead and current behavior; it does not establish a precise before/after speed ratio on the server.

## Measured saved run

The 60-page job used three 20-page reviews followed by reconciliation. It completed without recorded retries and had **zero learned Brain candidates** in its saved reference snapshot.

| Interval | Recorded duration |
| --- | ---: |
| Creation to inventory-start event, including input loading and scheduling | 46 s |
| Inventory, extraction and batch planning | 3 m 27 s |
| First review request through saved checkpoint | 3 m 36 s |
| Second review request through saved checkpoint | 3 m 00 s |
| Third review request through saved checkpoint | 1 m 29 s |
| Reconciliation request through completion | 4 m 12 s |
| Total, including short gaps between stages | **16 m 34 s** |
| Creation to first saved review, during which reviewed pages remain zero | **7 m 49 s** |

The four saved provider responses consumed 39,306 output tokens in total. Cache-read input tokens were zero. These observations do not predict the duration or usage of a single combined request.

A second, 10-page unclassified job took **3 m 22 s**, with zero learned Brain candidates and one review request. Its reviewed-page counter stayed at zero until approximately completion.

## Findings

### P1 — A global serial queue is presented as active analysis

Locations: `server/ai/analysisJobs.mjs:154`, `:374`; `server/ai/analysisJobRoutes.mjs:4`, `:42`; `src/components/AnalysisWorkspace.jsx:30`, `:108`.

`busy` and `queue` belong to the whole worker instance. `drain()` awaits an entire job before starting the next. Account ownership affects visibility and identity, not scheduling. Different claims on different accounts therefore do not run independently.

The queued job does not yet have `units`, `total_pages`, or `batches`. Public status defaults these counters to zero. The UI combines `queued` and `running` into the same “Analysis in progress” heading. No queue position or queue-wait duration is supplied. This explains the user's second PC showing queued 0/0 while the first is reviewing a batch.

Recommendation: show **Waiting to start**, queue position, time since submission, and a privacy-preserving explanation that another analysis occupies the worker. Do not expose other users' claim names or account details. Consider bounded worker concurrency only after fixing blocking input loading and measuring CPU, memory and provider rate limits.

### P1 — The fixed 20-page limit adds repeated analysis requests even when a combined request fits

Locations: `server/ai/analysisJobs.mjs:154`, `:239`, `:291`, `:340`; introduction of the hard cap in commit `2554132`.

Extraction units and provider review batches are both bounded to 20 pages. Multiple batches receive the same full structured-output schema and loss-adjuster reasoning protocol, followed by another complete reconciliation response. The intermediate scope is appended, but the full report-analysis instructions remain in each request.

With a single 71-page PDF and default settings, the normal plan is four reviews plus reconciliation: **five sequential provider requests**, before any retry or further split. Earlier resumable code could combine extraction units when the measured request fit the budget.

The saved 60-page evidence fits the current request estimator when combined: 117,116 estimated input tokens, 33 images, and approximately 2.57 MB. Nevertheless the current planner forces three reviews plus reconciliation. This fit result is close to the default input threshold and is an estimate, not proof of actual provider acceptance or equivalent quality.

Recommendation: distinguish durable extraction checkpoint size from provider request size. Evaluate budget-based grouping and a single complete review for eligible evidence. Keep staged review for files that exceed safe budgets. Validate every page, citations, material issues and cross-section consistency against approved regression bundles before changing grouping. Do not make smaller batches the default merely to move the counter more often; they can increase total request count.

### P1 — Saved binary input is synchronously decoded through a JSON reviver for every byte

Locations: `server/ai/analysisJobStore.mjs:8`, `:22`, `:31`; `server/ai/analysisJobs.mjs:197`.

Buffers serialize as JSON arrays of numbers. A 16.31 MB original PDF produced a **58.52 MB input checkpoint**. `JSON.parse(text, revive)` calls the reviver for each array element, then creates a Buffer. The synchronous load happens before the running/inventory-start state is saved.

One local load using the current store took **32.77 s**. A diagnostic comparison reading the same file, parsing without a reviver and hydrating the known file-buffer fields took **0.74 s** total (229 ms read, 430 ms parse, 78 ms hydration). These single local measurements are not a server benchmark or an implemented replacement.

While synchronous decoding runs, the same Node process cannot answer progress/health requests or run request deadline timers. Repeated evidence checkpoint reads also parse image buffers through this path. Durable writes use synchronous serialization and `fsync`.

Recommendation: first replace per-number revival with structural Buffer hydration that supports existing input and image checkpoints. Preserve byte equality and saved jobs. Subsequently evaluate binary sidecar files and asynchronous I/O, retaining atomic checkpoint completion. Avoid simply disabling durable writes.

### P1 — The principal counter hides completed extraction and advances only in batch-sized jumps

Locations: `server/ai/analysisJobStore.mjs:62`; `src/components/AnalysisWorkspace.jsx:100`, `:101`, `:139`.

The main counter and bar measure saved AI-reviewed pages. Extraction checkpoints appear in secondary copy, and their totals are unknown until inventory completes. The initial 0/0 also appears for a queued job. During a 20-page review, no per-page acknowledgement exists in the provider response.

Recommendation: expose distinct saved metrics and current work, for example:

```text
Evidence prepared: 71/71 pages
AI review saved: 20/71 pages
Reviewing batch 2/4 · pages 21–40
Generating response · current attempt 0m 27s
```

Show planning text while totals are unknown. Add total job elapsed time alongside current-attempt time, which resets on retries. Keep reviewed pages tied to checked, saved work. The report specification explicitly prohibits timer-driven completion estimates; streaming bytes or elapsed seconds must not become a fabricated review percentage.

### P2 — “Receiving AI response data” measures transport activity, not completed review

Locations: `server/ai/providers/anthropicTransport.mjs:35`; `server/ai/analysisJobs.mjs:263`.

Every non-empty response chunk produces the same `receiving` stage. Initial events, keep-alive messages, private thinking and structured result content are not distinguished. A recent connection-activity timestamp alone cannot establish that another page was reviewed. Anthropic documents distinct event types and ping messages in its [streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming).

Recommendation: use a small incremental SSE event reader to distinguish waiting, model processing, result generation and validation through event metadata. Publish no model text or private reasoning. Keep a separate network-activity age and saved-work count. Retain existing total and idle deadlines.

### P2 — PDF chunking changes extraction cost and makes the densest raster tier unreachable

Locations: `server/evidence/extractEvidence.mjs:113`, `:170`, `:236`, `:244`; `server/ai/analysisJobs.mjs:205`.

Each range reopens the original PDF. The native-PDF shortcut is disabled whenever `pageRange` is supplied. Raster quality is chosen per range: the 900-pixel tier requires more than 20 selected visual pages, but the job's ranges cannot contain more than 20 pages. A dense bundle therefore never reaches that tier through the job path. Its per-range images can be larger than the previous whole-document raster tier.

The measured run spent over three minutes in inventory/extraction/planning. This interval includes rendering, storage and planning; exact attribution needs finer timing instrumentation.

Recommendation: measure page text extraction, raster detection/rendering, PDF-open overhead and checkpoint I/O separately. Choose an economical visual tier from the full inventory while preserving readability and every required visual page. Reuse a bounded PDF context rather than reopening the same document for every range where feasible.

### P2 — Brain is bounded and separate, but added context and cache behavior need measurement

Locations: `server/ai/brain/brainReferences.mjs:3`; `server/ai/referenceLayer.mjs:217`; `server/ai/brain/brainPolicy.mjs:35`; `server/ai/providers/anthropicProvider.mjs:1188`.

The claim-analysis path retrieves activated methodology manifests; it does not digest historical reports again for each claim. Unclassified claims receive no learned methodology. Selection sends at most three approved topic/line-matched Brain manifests. Raw historical reports are not sent as current claim evidence.

Each manifest can hold 20 notes of 1,500 characters, permitting up to 90,000 note characters across three manifests. Applicable methodology is repeated with review requests. The cache marker sits on a text block containing changing claim evidence; the measured multi-batch run had zero cache-read tokens. Anthropic's [prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) describes prefix matching at cache breakpoints; changing that prefix explains why this marker does not guarantee reuse between batches.

Both examined slow runs had zero learned Brain references. Brain therefore cannot explain their measured latency. Core approved methodology is distinct from learned Brain and was still available.

Recommendation: record actual selected reference counts and sizes, separate stable instructions/methodology from changing evidence for cache evaluation, and compare the same evidence with the same model. A new Brain size limit or altered methodology content must be reviewed against the approved specification rather than silently truncating rules.

### P2 — Recovery handles provider deadlines and dead processes, but not arbitrary worker health

Locations: `server/ai/analysisJobs.mjs:165`, `:250`, `:383`; `server/ai/analysisJobStore.mjs:35`; `server/ai/providers/anthropicTransport.mjs:1`.

Provider attempts already have a five-minute cap, a default two-minute silent-connection timeout and up to three attempts. Process restart preserves completed checkpoints and marks unfinished jobs interrupted when read; they require explicit resume. Windows recovery restarts a failed service but does not detect a running process whose analysis worker is unhealthy.

Extraction and synchronous storage do not have comparable interruptible stage deadlines. PID locks test process existence, not worker heartbeat. The queue's outer drain rejection is discarded. No evidence establishes these as the cause of this particular live job, but they limit fault visibility.

Recommendation: add structured phase timings, queue/worker status, recoverable error logging and bounded extraction isolation before promising automatic self-repair. A monitor must not treat “zero newly saved pages” as a hung request; legitimate provider activity can precede the first saved batch for several minutes. Preserve existing checkpoints and the approved explicit-resume behavior unless a new automatic-resume policy is approved.

## UI technical assessment

These scores concern the progress component only, based on source and the supplied desktop screenshots. They are not a full accessibility certification or a tested mobile/browser matrix.

| Dimension | Score / 4 | Evidence |
| --- | ---: | --- |
| Accessibility | 3 | Progressbar value text, status/error roles and reduced-motion spinner are present; stage navigation lacks an explicit current-step announcement. |
| Performance | 1 | Shared-process synchronous decoding delays status delivery; running pages also have independent 2 s and 3 s polling loops. |
| Responsive design | 3 | Stage grid and actions wrap; small disclosure summaries have no minimum touch target. Mobile rendering was not exercised. |
| Theming | 3 | Semantic tokens are used consistently; computed contrast and all themes were not measured. |
| Implementation integrity | 2 | Correct saved-work semantics and source identity are preserved, but queued/active labels and unknown totals miscommunicate the state. |
| Total | **12 / 20** | Significant progress-state and execution work remains. |

The component fits the existing ULA design system. Behavioral status communication needs correction. The detector found no mechanical design violations.

## Recommended order

1. Correct queue/unknown-total copy, add anonymous queue position and surface current ranges; retain account isolation. UI follow-up: Impeccable clarify/harden.
2. Fix Buffer decoding with backward compatibility and byte-for-byte tests. Add structured duration/size measurements. UI polling follow-up: Impeccable optimize.
3. Benchmark and revise request grouping separately from extraction checkpoints. Preserve all current evidence, grounding, calculation and approval requirements.
4. Benchmark PDF rendering tiers and repeated document opens, then method/context/cache size.
5. Evaluate a small bounded concurrency setting and worker-health recovery using measured resource and provider capacity. Include multi-user scheduling tests.
6. Confirm the UI once after the functional changes; Impeccable polish is the final UI pass.

Do not estimate review progress from a timer, weaken evidence/citation checks, expose another account's job content, or use periodic whole-service restarts as normal scheduling.

## Validation and limits

The 17 existing tests passed, including saved-result reuse, bounded retries, owner isolation, 180-page extraction coverage, restart recovery, rejected citations, stream deadlines, and workspace job selection. `npm run lint`, `npm run typecheck`, and `npm run build` also passed. These checks do not establish production throughput or queue visibility across PCs.

There was no frontend or backend code change. Future implementation should run the project's lint, typecheck and build, plus meaningful storage compatibility, queued-state, multi-user scheduling and report regression checks for its scope. A real before/after comparison must use the same evidence and model and record time to first saved extraction, first saved review and final result separately.
