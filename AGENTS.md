# AGENTS.md

## Mandatory report specification

Before planning, reviewing, testing, or implementing any change that can affect claim analysis, report content, report structure, report calculations, evidence citations, photographs, templates, previews, or DOCX/PDF export, read `docs/REPORT_SPEC.md` in full and follow it as the project source of truth.

Do not change an approved report rule silently. If a requested report change conflicts with `docs/REPORT_SPEC.md`, identify the conflict and update the specification only when the user has explicitly approved the new rule. Keep production code, tests, templates, prompts, and the specification aligned.

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
