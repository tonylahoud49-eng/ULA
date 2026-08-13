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

Three providers are supported: OpenAI (Responses API), Google Gemini, and OpenRouter (both via Chat Completions API with structured output). Models are configurable per provider; defaults are `gpt-5.6-terra`, `gemini-2.5-flash`, and `google/gemma-4-31b-it:free`. Every analysis request sends the registered evidence set together:

- Searchable and scanned PDFs are supplied as PDF file inputs; searchable page text is also extracted for verifiable citations.
- PNG, JPEG, WebP, and GIF evidence is supplied as vision input.
- DOCX, XLSX, EML, TXT, CSV, JSON, XML, HTML, Markdown, and RTF content is extracted server-side and included with document boundaries.
- One file may produce multiple semantic document types, including embedded Claim Form content.
- Values without a supporting source are returned as `Requires confirmation`; unverified extracted-text citations are discarded.

Legacy `.doc`, Outlook `.msg`, encrypted files, and formats outside the list above currently require conversion or a future extractor. Upload and total-request limits are configured by `AI_MAX_FILES`, `AI_MAX_FILE_BYTES`, and `AI_MAX_TOTAL_BYTES`.

Optional approved report-style manifests can be loaded through `ULA_REPORT_REFERENCE_DIR`. This reference layer accepts only explicitly approved JSON manifests containing structure/style guidance; it never treats historical report facts as current claim evidence.

## Local data and authentication

The application stores lightweight accounts, claim metadata, reports, employees, and leave records in browser localStorage. Uploaded file blobs are stored separately in IndexedDB. The Google sign-in button creates or opens a local demonstration account. Email/password registration and login are also supported locally.

This persistence and authentication remain intended for development and demonstration. Production use still requires a secure server database, server-side authentication/authorization for `/api/ai/analyze`, email delivery, and durable document storage such as SharePoint or another backend. AI suggestions never silently replace claim fields; users review and save them through the existing workflow.
