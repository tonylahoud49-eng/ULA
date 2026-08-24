# Approved report style references

This directory is reserved for explicitly approved JSON manifests. They may describe section order and writing style, but they are never claim evidence and must not contain reusable claim facts.

Example manifest:

```json
{
  "approved": true,
  "title": "Approved marine report structure",
  "section_order": ["Executive Summary", "Policy", "Circumstances", "Adjustment"],
  "style_notes": ["Use concise factual paragraphs", "Separate evidence from professional opinion"]
}
```

Set `ULA_REPORT_REFERENCE_DIR` to the directory containing approved manifests. Raw historical reports are deliberately not loaded automatically.

## Local legal-reference knowledge

Legal books, statutes, rules, guidance, and technical references belong in the separate ignored local index at `.data/legal-references/index.json`. They are treated collectively as a professional knowledge base. The server retrieves only excerpts relevant to the particular claim, policy/contract, jurisdiction, loss type, dates, and established facts; differences in scope or applicability must be resolved rather than blended. References may improve reasoning, but they are never claim evidence or report content, cannot populate facts, amounts, dates, parties, calculations, or evidence citations, and must not be quoted, summarized, cited, or named in the report.

Build or refresh the local index with:

```bash
node scripts/build-legal-reference-index.mjs --output .data/legal-references/index.json <reference.pdf> [...]
```

Set `ULA_LEGAL_REFERENCE_INDEX` only when the index is stored elsewhere. Raw PDFs are not sent automatically and the `.data/` index is excluded from Git.
