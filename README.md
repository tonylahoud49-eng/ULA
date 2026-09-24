# ULA AI Claims Hub

React and Vite application for claims management, document review, report drafting, and annual leave administration.

For complete setup, PostgreSQL, Windows deployment, IIS/NSSM, backup, workflow, troubleshooting, and maintenance instructions, see [`docs/ULA_FULL_DOCUMENTATION.md`](docs/ULA_FULL_DOCUMENTATION.md).

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

## Multi-User Internal Deployment & Persistence

Production is a server-backed multi-user application:

- PostgreSQL stores accounts, sessions, claims, document metadata, report versions, employees, leave requests, shared settings, and append-only audit history.
- Row-level security protects private claims and employee records. The runtime role must not own the protected tables or have `SUPERUSER` or `BYPASSRLS`.
- Uploaded physical documents remain under `.data/uploads` on the application server and must be included in backups.
- A production build requires `VITE_SQL_BACKEND=true`; server-backed mode never falls back to browser IndexedDB after a server storage error.
- JSON and browser persistence remain available only for local development. `NODE_ENV=production` refuses to start without PostgreSQL.

See `docs/WINDOWS_PRODUCTION_DEPLOYMENT.md` for the Windows cutover and legacy-data import procedure.

- **Team Members & Authentication**:
  - Pre-seeded with 7 official ULA team members:
    - Petro Zaarour (`petro.zaarour@ula.com`)
    - Annie Abdel Massih (`annie.abdelmassih@ula.com`)
    - Estefani Haddad (`estefani.haddad@ula.com`)
    - Hovig Kalandjian (`hovig.kalandjian@ula.com`)
    - Feyez Dghayli (`feyez.dghayli@ula.com`)
    - Rana Rizk (`rana.rizk@ula.com`)
    - Fares Fares (`fares.fares@ula.com`)
  - Quick 1-click test sign-in buttons are available on `/login`, or users can sign in with their corporate email and default password `ula123`.
  - Re-seed at any time with: `npm run seed`.

- **Multi-Provider AI Analysis Engine**:
  - Configured with OpenRouter (`openrouter/auto`, `meta-llama/llama-3.3-70b-instruct`, `deepseek/deepseek-chat`), Groq (`openai/gpt-oss-120b`), Anthropic (`claude-sonnet-4-6`), and Gemini (`gemini-2.5-flash`).
  - Includes a 10-second fast reachability timeout and automatic grounding source verification to prevent false field withholding.

### Starting the Server for Local Development

```bash
# 1. Install dependencies (if fresh clone)
npm install

# 2. Seed default users and employees
npm run seed

# 3. Start the local API and Vite client
npm run dev
```

For production, apply the PostgreSQL migrations, import the reviewed legacy snapshot, build, run `npm run production:check`, and then start the Windows service.

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
