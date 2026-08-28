# ULA AI Claims Hub

React and Vite application for claims management, document review, report drafting, and annual leave administration.

## Requirements

- Node.js 20.19 or newer
- npm

## Install and run

```bash
npm install
copy .env.example .env
npm run dev
```

`npm run dev` starts the Vite frontend and the local server-side API together. Configure at least one AI provider in `.env` before using **Run AI Analysis**. Set `AI_PROVIDER` to your preferred provider; any other provider with a configured API key becomes an automatic fallback.

**Google Gemini** (recommended — free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)):

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
```

**OpenAI:**

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.6-terra
```

**OpenRouter** (free models available — key from [openrouter.ai/keys](https://openrouter.ai/keys)):

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemma-4-31b-it:free
```

**Anthropic Claude**:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-sonnet-5
```

Configure multiple keys for automatic fallback. For example, setting `AI_PROVIDER=gemini` with both `GEMINI_API_KEY` and `OPENROUTER_API_KEY` will try Gemini first and fall back to OpenRouter on rate limits or errors.

Keys are read only by `server/index.mjs`; they are never exposed through a `VITE_` variable or included in the browser bundle. If no provider is configured, the app reports that AI analysis is unavailable and does not substitute a local/mock confidence score.

Create a production build with:

```bash
npm run build
```

Run code checks with:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## AI document analysis

Four providers are supported: Anthropic Claude (Messages API), OpenAI (Responses API), Google Gemini, and OpenRouter (the latter two via Chat Completions API). Models are configurable per provider; Claude defaults to `claude-sonnet-5`. When Claude is selected, provider errors are returned directly and are not hidden by another-provider fallback. Every analysis request sends the registered evidence set together:

- Searchable and scanned PDFs are supplied as PDF file inputs; searchable page text is also extracted for verifiable citations.
- PNG, JPEG, WebP, and GIF evidence is supplied as vision input.
- DOCX, XLSX, EML, TXT, CSV, JSON, XML, HTML, Markdown, and RTF content is extracted server-side and included with document boundaries.
- One file may produce multiple semantic document types, including embedded Claim Form content.
- Values without a supporting source are returned as `Requires confirmation`; unverified extracted-text citations are discarded.

Legacy `.doc`, Outlook `.msg`, encrypted files, and formats outside the list above currently require conversion or a future extractor. Upload and total-request limits are configured by `AI_MAX_FILES`, `AI_MAX_FILE_BYTES`, and `AI_MAX_TOTAL_BYTES`.

Optional approved report-style manifests can be loaded through `ULA_REPORT_REFERENCE_DIR`. This reference layer accepts only explicitly approved JSON manifests containing structure/style guidance; it never treats historical report facts as current claim evidence.

## Local data and authentication

The application stores claim metadata, reports, employees, and leave records in browser localStorage. Uploaded file blobs are stored separately in IndexedDB. Authentication and User Administration are enforced by the backend using an HTTP-only session cookie and the server-side `.data/auth-state.json` approved-user directory.

Public registration and Google sign-in are disabled. Only accounts created in User Administration and marked **Access granted** can sign in with their company email and ULA system password. Revocation invalidates active sessions immediately. Password hashes and session tokens are never returned to the browser.

This persistence and authentication remain intended for development and demonstration. Production use still requires a secure server database, server-side authentication/authorization for application APIs, and durable document storage such as SharePoint or another backend. AI suggestions never silently replace claim fields; users review and save them through the existing workflow.

## Email notifications for Annual Leave / TOIL

Leave notification emails are sent securely from the backend with idempotency, automatic deduplication, and atomic balance safeguards. Two providers are supported:

### 1. EmailJS Provider (Recommended / Easiest)
Connect your Outlook, Gmail, or SMTP account directly via [EmailJS](https://www.emailjs.com/):

```dotenv
LEAVE_EMAIL_PROVIDER=emailjs
EMAILJS_SERVICE_ID=service_xxx
EMAILJS_TEMPLATE_ID=template_xxx
EMAILJS_PUBLIC_KEY=your-public-key
EMAILJS_PRIVATE_KEY=your-private-key
LEAVE_ADMIN_EMAIL=leave-manager@company.example
LEAVE_ADMIN_CC_EMAIL=second-leave-manager@company.example
APP_BASE_URL=http://localhost:5173
```

In your EmailJS template:
- Subject: `{{subject}}`
- To Email: `{{to_email}}`
- CC: `{{cc_email}}`
- Body: `{{{message_html}}}` (triple braces render formatted HTML directly).

### 2. Microsoft Graph Provider (Alternative)
Direct corporate Microsoft 365 OAuth 2.0 client-credentials flow (`Mail.Send` application permission):

```dotenv
LEAVE_EMAIL_PROVIDER=microsoft_graph
MICROSOFT_TENANT_ID=your-tenant-id
MICROSOFT_CLIENT_ID=your-application-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_SENDER_EMAIL=leave-notifications@company.example
LEAVE_ADMIN_EMAIL=leave-manager@company.example
LEAVE_ADMIN_CC_EMAIL=second-leave-manager@company.example
APP_BASE_URL=http://localhost:5173
```

The leave workflow saves the request before attempting email delivery. Failed delivery remains visible on the request and can be retried with the same idempotency key. Approval and rejection are atomic local transitions: Pending requests do not deduct balances, rejection never deducts, and approval records a permanent deduction marker so the same request cannot deduct twice. Approved requests continue to appear in the existing company calendar.
