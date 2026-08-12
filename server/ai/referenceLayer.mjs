import fs from "node:fs/promises";
import path from "node:path";

export async function loadApprovedStyleReferences(directory) {
  if (!directory) return [];
  let names;
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }

  const references = [];
  for (const name of names.filter((item) => item.toLowerCase().endsWith(".json"))) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
      if (parsed.approved !== true) continue;
      references.push({
        title: String(parsed.title || name),
        section_order: Array.isArray(parsed.section_order) ? parsed.section_order.map(String) : [],
        style_notes: Array.isArray(parsed.style_notes) ? parsed.style_notes.map(String) : [],
        source_role: "style_reference_only",
      });
    } catch {
      // Invalid or unapproved manifests are intentionally ignored.
    }
  }
  return references;
}
