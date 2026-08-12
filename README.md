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

`npm run dev` starts the Vite frontend and the local server-side API together. Add an OpenAI API key to `.env` before using **Run AI Analysis**:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_server_side_key
OPENAI_MODEL=gpt-5.6-terra
```

The key is read only by `server/index.mjs`; it is never exposed through a `VITE_` variable or included in the browser bundle. If the key or provider is unavailable, the app reports that AI analysis is unavailable and does not substitute a local/mock confidence score.

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

The current provider is OpenAI through the Responses API using structured output. The model is configurable with `OPENAI_MODEL`; `gpt-5.6-terra` is the default. Every analysis request sends the registered evidence set together:

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
