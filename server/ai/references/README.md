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
