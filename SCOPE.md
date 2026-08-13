# ULA Claims Hub — Application Scope

## Product Identity

**ULA AI Claims Hub** is a web application for United Loss Adjusters & Surveyors that supports the full lifecycle of insurance claims — from intake and evidence management through AI-assisted analysis to controlled report drafting, professional review, and final approval.

---

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS + custom design tokens (see `DESIGN.md`) |
| Routing | React Router v6 |
| State / Data | React Query, localStorage (metadata), IndexedDB (uploaded file blobs) |
| Server | Express.js (`server/index.mjs`) — runs alongside Vite dev server |
| AI Providers | Google Gemini, OpenAI (Responses API), OpenRouter (Chat Completions API) |
| Auth | Local demo auth (email/password + Google OAuth stub), stored in localStorage |

---

## Application Pages & Routes

| Route | Page Component | Purpose |
| --- | --- | --- |
| `/` | `Dashboard` | Portfolio overview — KPI metrics, recent claims register, charts by business line / status / surveyor |
| `/claims` | `Claims` | Searchable, filterable claims register table |
| `/claims/:id` | `ClaimDetail` | Single-claim workspace — overview, documents tab, report versions tab, release chain, inline AI analysis |
| `/ai-reporting` | `AIReporting` | Guided 5-step wizard for claim analysis and controlled report generation |
| `/annual-leave` | `AnnualLeave` | Employee leave management (HR feature) |
| `/login` | `Login` | Email/password + Google sign-in |
| `/register` | `Register` | Account creation with OTP verification |
| `/forgot-password` | `ForgotPassword` | Password reset request |
| `/reset-password` | `ResetPassword` | Password reset completion |
| `/oauth/consent` | `OAuthConsent` | OAuth consent screen |

---

## Core Entities (localStorage)

| Entity | Key Fields |
| --- | --- |
| **Claim** | `id`, `claim_number`, `title`, `business_line`, `status`, `priority`, `insured`, `insurer`, `broker`, `policy_number`, `policy_limit`, `deductible`, `date_of_loss`, `surveyor`, `cause_of_loss`, `claim_amount`, `ai_confidence`, `ai_analysis_status`, `missing_documents`, workflow assignments (`prepared_by`, `reviewed_by`, `approved_by`), transport fields (`vessel_name`, `container_number`, ports) |
| **ClaimDocument** | `id`, `claim_id`, `file_name`, `file_type`, `category`, `file_mime_type`, `storage_key`, `detected_categories`, `extraction_status`, `content_analysis_basis`, `content_analysis_provider` |
| **ReportVersion** | `id`, `claim_id`, `version_number`, `status` (Draft/Final), `issue_state`, `template_id`, `template_name`, `assignments`, `readiness`, `content` (markdown), `generated_by`, `approved_by`, `approved_date` |
| **User** | `id`, `email`, `full_name`, `passwordHash` |
| **Employee** | `id`, `annual_leave_total`, `annual_leave_used`, `toil_balance` |
| **Leave** | `id`, `status` |

---

## Business Lines & Report Templates

Each business line maps to a specialised report template with line-specific sections, required fields, and required document categories:

1. **Yacht** — Interest & Policy, Yacht Particulars, Circumstances, Repair Schedule, Jurisdiction
2. **Property** — Premises, Loss History, Damage Extent, Fire Investigation, Sums Insured
3. **Marine Cargo (Reefer/GFS)** — Routing, Temperature/Cold-Chain, Notice of Claim, Weather, Timing
4. **Marine Cargo (Non-Reefer)** — Routing, Surveyor Notes, Notice, Weather, Timing
5. **Bulk Vessel** — Survey Timeline, Routing, Notices, Certificates, Recovery/Salvage
6. **Air Shipment (NET)** — Interest Insured, Warranties, Assessors, Insured Value
7. **Land Shipment** — Interest Insured, Transport Particulars, Driver/Vehicle
8. **Fidelity Claims** — Employee Particulars, Investigations, Ledger Review, Special Clauses
9. **Unclassified / Requires Review** — General fallback template

All templates share common sections: Cover Page, Document Control, Version History, Report Summary, Claim Salient Details, Appointment & Scope, Investigation & Findings, Cause of Loss, Coverage Analysis, Adjustment, Conclusion, Supporting/Outstanding Documents, Appendices, Corporate (ULA & Strategic Alliances).

---

## Report Lifecycle (Release Chain)

Five controlled gates that every claim progresses through:

```
Evidence → Analysis → Adjustment → Review → Approval
```

1. **Evidence** — Source documents and field material are registered
2. **Analysis** — Facts are extracted, classified, and linked to evidence
3. **Adjustment** — Claimed, covered, deducted, and adjusted values are reviewed
4. **Review** — A professional reviewer checks the complete draft
5. **Approval** — An authorized approver signs and issues a controlled version

---

## Workflow Roles

| Role | Responsibilities | Permissions |
| --- | --- | --- |
| **Investigator / Attendee** | Field investigation, evidence collection, findings | `view_assigned_claim`, `upload_evidence`, `record_findings`, `submit_investigation` |
| **Preparer / Writer** | Claim data entry, report drafting, adjustment | `edit_claim_facts`, `draft_report`, `edit_adjustment`, `submit_for_review` |
| **Reviewer** | Professional review, comments, change requests | `review_report`, `comment`, `request_changes`, `complete_review` |
| **Approver** | Final approval, signing, issuing, creating revisions | `approve_report`, `sign_report`, `issue_final`, `create_revision` |

A single person may hold multiple roles on the same report when authorized.

---

## Claim Statuses

`New` → `Under Investigation` → `Pending Documents` → `Report Draft` → `Report Final` → `Closed`

---

## AI Document Analysis

### Supported Input Formats

| Category | Formats |
| --- | --- |
| PDF (native) | Searchable + scanned PDFs — supplied as file inputs with extracted page text |
| Images | PNG, JPEG, WebP, GIF — supplied as vision input |
| Office / text | DOCX, XLSX, EML, TXT, CSV, JSON, XML, HTML, Markdown, RTF — server-side extraction |
| Unsupported | Legacy `.doc`, Outlook `.msg`, encrypted files — require conversion |

### What AI Returns

- **Business-line classification** with confidence score and rationale
- **Document-type detection** per uploaded file (Policy, Bill of Lading, Invoice, etc.)
- **Field extraction** — structured claim data with per-field source provenance
- **Missing document categories** — evidence gaps identified by the template
- **Evidence findings and warnings** — review notes, extraction issues
- **Suggested claim data** — pre-fills empty fields (never overwrites user-entered data)
- **Human review flags** — sections requiring professional judgment

### Provider Fallback

If `AI_PROVIDER` is set to one provider (e.g., Gemini) and another provider's API key is also configured, the system automatically falls back on rate limits or errors.

---

## Detailed User Flow: Analyse a Claim & Generate a Report

There are **two paths** to reach analysis and report generation:

---

### Path A: AI Reporting Wizard (`/ai-reporting`)

This is the primary guided workflow — a 5-step wizard.

#### Step 0 — Select Claim

1. User navigates to **AI Reporting** from the sidebar or clicks **"+ New AI Claim"** on the Claims page.
2. The wizard loads all existing claims sorted by most recent.
3. The user either:
   - **Selects an existing claim** from the scrollable list, or
   - Clicks **"Create New AI Claim"** — this auto-generates a claim number (`ULA-{YEAR}-{NNNN}`), creates a claim record with status `New`, business line `Unclassified`, and immediately selects it.
4. Clicking **Continue** advances to Step 1.

#### Step 1 — Upload Evidence

1. The wizard shows the selected claim's identity and the current report template name.
2. The **DocumentUploader** component appears — the user drags/drops or browses files.
3. Each uploaded file is:
   - Stored in **IndexedDB** via `documentStorage.save()` (binary blob stays out of localStorage).
   - A **ClaimDocument** metadata record is created in localStorage with `storage_key`, `file_name`, `file_mime_type`, `file_type`, `category`, etc.
4. The user can upload multiple files (PDFs, images, DOCX, etc.).
5. The **Continue** button is disabled until at least one document is registered.
6. Clicking **Continue** advances to Step 2.

#### Step 2 — AI Analysis

1. The wizard shows a summary: *"Ready to review N source document(s)"*.
2. The user clicks **"Run AI Analysis"**.
3. **What happens behind the scenes:**
   1. `appClient.functions.invoke("analyseClaim", { claim_id })` is called.
   2. `buildAnalysis()` in `appClient.js`:
      - Fetches the claim and all its `ClaimDocument` records.
      - Calls `analyzeClaimWithProvider({ claim, documents })` in `aiAnalysisClient.js`.
   3. `analyzeClaimWithProvider()`:
      - For each document, retrieves the binary blob from IndexedDB via `documentStorage.get()`.
      - Builds a `FormData` with all file blobs + a JSON manifest (document IDs, filenames, MIME types, categories) + the claim JSON.
      - POSTs to **`/api/ai/analyze`** on the local Express server.
   4. **Server-side** (`server/index.mjs`):
      - Validates the claim and evidence set (file count, total size).
      - For each file, calls `extractEvidenceFile()` — extracts text from PDFs, DOCX, XLSX, etc.; prepares images for vision input.
      - Loads optional approved report-style references from `ULA_REPORT_REFERENCE_DIR`.
      - Calls the configured AI provider (`createConfiguredProvider()`) with the claim, extracted evidence, raw files, and style references.
      - The AI provider returns structured JSON: classification, document types, extracted fields, missing documents, findings, warnings.
      - Server returns the result + any extraction warnings.
   5. **Back on the client**, `mapAnalysis()` transforms the raw AI response into:
      - `confidence` (0–100%), `business_line`, `template_id`, `template_name`
      - `suggested_claim_data` — a flat object of extracted field values (only fills empty/null fields)
      - `evidence_sources` — provenance records linking each suggestion to a document + page + matched text
      - `missing_documents`, `warnings`, `human_review_required`
   6. `buildAnalysis()` then:
      - Updates each `ClaimDocument` record with `detected_categories`, `extraction_status`, `content_analysis_provider`, etc.
      - Updates the `Claim` record with `ai_confidence`, `ai_classification_source`, `ai_suggested_business_line`, `ai_analysis_status`, `missing_documents`.
4. The wizard auto-advances to **Step 3** on success.
5. If the AI provider is unavailable or fails, an error banner is shown with the reason.

#### Step 3 — Review & Edit

1. **Classification summary card** shows:
   - Suggested template name (e.g., "Marine Reefer Cargo Report")
   - AI confidence percentage (colour-coded: green ≥80%, amber ≥60%, red <60%)
   - Summary text from the AI
   - Missing evidence categories (amber warning)
   - Review warnings list
2. **Readiness panel** shows:
   - Overall template readiness percentage
   - Field completion percentage
   - Document coverage percentage
3. **Editable claim fields form** — all fields pre-filled with AI suggestions merged into existing data:
   - AI suggestions only fill fields that were empty/null/blank (or `business_line` was `Unclassified`).
   - User can manually override any value.
   - Fields include: business line, insured, insurer, broker, policy number, policy limit, deductible, dates, surveyor, workflow assignments, vessel/port details, claim amount, cause of loss.
4. **Evidence provenance table** — shows each AI extraction linked to:
   - Source document name
   - Matched/supporting text quote
   - Page number
   - Confidence level
   - Review state
5. The user reviews, corrects, and clicks **"Save Changes"** to persist edits.
6. Clicking **Continue to Report** advances to Step 4.

#### Step 4 — Generate Report

1. **Pre-generation summary** shows:
   - Template name, readiness percentage, document count
   - Workflow role assignments (Investigator, Preparer, Reviewer, Approver) — pulled from claim data
   - A disclaimer: *"The generated document remains a draft. Cause, coverage, adjustment, liability, recommendations, and conclusion require professional review."*
2. The user clicks **"Generate Draft Report"**.
3. **What happens:**
   1. `appClient.functions.invoke("generateReport", { claim_id, edited_data })` is called.
   2. `buildReport()`:
      - Saves the latest edited data to the claim.
      - Calls `createUnifiedReportDraft()` from the reporting engine.
      - The reporting engine:
        - Selects the correct template based on business line.
        - Calculates readiness (missing fields + missing documents).
        - Builds workflow assignments.
        - Generates **structured markdown** with all template sections: Cover Page, Document Control, Version History, Claim Salient Details, then all line-of-business-specific sections, then common closing sections.
        - Sections requiring professional judgment are marked explicitly.
      - Creates a **ReportVersion** record: `status: "Draft"`, `issue_state: "Draft"`, with the generated content, assignments, readiness snapshot, evidence count.
      - Updates the claim status to `"Report Draft"`.
4. The user is **navigated to** `/claims/:id` (ClaimDetail page) where the new draft is visible under the **Report Versions** tab.

---

### Path B: Inline Analysis from Claim Detail (`/claims/:id`)

This is a shorter path for claims that already have documents uploaded.

1. User opens an existing claim from the Claims register or Dashboard.
2. On the **ClaimDetail** page, the user sees:
   - The **Release Chain** showing the current gate
   - Claim overview, documents tab, report versions tab
3. User goes to the **Documents** tab and uploads evidence via the DocumentUploader.
4. User clicks **"Run AI Analysis"** in the page header.
   - Same `buildAnalysis()` flow as Path A Step 2.
   - Results appear in an inline card: confidence %, summary, missing documents.
   - The claim record is updated with AI suggestions.
5. User can **edit claim details** on the Overview tab (click Edit → modify fields → Save).
6. User goes to the **Report Versions** tab and clicks **"Generate Draft Report"**.
   - Same `buildReport()` flow as Path A Step 4.
   - A new draft version appears in the report versions list.
7. User can **view** the rendered markdown report, or **approve** it:
   - Clicking **"Approve Final"** sets `status: "Final"`, `issue_state: "Final"`, records the approver name and date, and updates the claim status to `"Report Final"`.
   - Subsequent changes after approval create a **new version** rather than modifying the issued report.

---

## Report Approval & Versioning

- Draft reports can be viewed, edited (re-generated), or approved.
- Approving a report:
  - Sets the report version to `Final`.
  - Records: `approved_by` (current user's name), `approved_date`, `issue_state: "Final"`.
  - Updates the parent claim status to `"Report Final"`.
- After a report is approved, generating another report creates **Version N+1** — the previous final version remains immutable.
- This creates an auditable version history with explicit responsibility assignments.

---

## Key Architectural Principles

1. **Evidence before inference** — every report statement traces to uploaded evidence.
2. **Human judgment is final** — AI drafts content but cannot approve, finalize, or replace professional review.
3. **One controlled core, specialized where necessary** — shared report structure with business-line modules.
4. **Responsibility is explicit** — workflow assignments, titles, dates, and version transitions are auditable.
5. **Binary content is separate** — file blobs live in IndexedDB; only metadata lives in localStorage.
6. **Provider-agnostic AI** — pluggable providers (Gemini, OpenAI, OpenRouter) with automatic fallback.

---

## Open Decisions / Future Work

- Final DOCX/PDF export requirements
- Legal-entity and office-specific footer variants
- Production backend / database migration (currently localStorage + IndexedDB)
- Server-side authentication and authorization for `/api/ai/analyze`
- Official vector logo source
- Production document storage (SharePoint or equivalent)
- Email delivery for password resets and notifications
