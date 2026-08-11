# ULA AI Claims Hub

React and Vite application for claims management, document review, report drafting, and annual leave administration.

## Requirements

- Node.js 20.19 or newer
- npm

## Install and run

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

Run code checks with:

```bash
npm run lint
npm run typecheck
```

## Local data and authentication

The application runs independently and stores accounts, claims, documents, reports, employees, and leave records in browser localStorage. The Google sign-in button creates or opens a local demonstration account. Email/password registration and login are also supported locally.

This local persistence is intended for development and demonstration. Production use still requires a secure server database, server-side authentication, email delivery, file storage, and an AI provider. The local analysis and report actions generate deterministic review placeholders so the current workflow remains usable without external services.
