# AGENTS.md

## Project context

This is a user-owned React, Vite, and Tailwind application. Keep changes focused, preserve the existing UI and business workflows, and prefer the smallest safe implementation.

## Key files

- `src/`: frontend application source.
- `src/api/appClient.js`: local persistence, authentication, uploads, and workflow adapter.
- `vite.config.js`: Vite and React configuration.
- `package.json`: dependency and script definitions.

## Validation

Run the configured checks before finishing changes:

```bash
npm run lint
npm run typecheck
npm run build
```
