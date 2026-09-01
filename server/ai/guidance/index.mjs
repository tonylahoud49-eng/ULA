import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LINE_GUIDANCE_MAP = {
  "Marine Cargo (Non-Reefer)": "lines/marine-cargo-non-reefer.md",
  "Marine Cargo (Reefer/GFS)": "lines/marine-cargo-reefer.md",
  "Air Shipment (NET)": "lines/air-cargo.md",
  "Bulk Vessel": "lines/bulk-vessel.md",
  "Fidelity Claims": "lines/fidelity.md",
  "Property": "lines/property.md",
  "Yacht": "lines/yacht.md",
  "Land Shipment": "lines/land-transit.md",
};

let cachedCore = null;
let cachedFinance = null;
const cachedLines = new Map();

export async function getAdjustingGuidance(businessLine = "") {
  try {
    if (!cachedCore) {
      cachedCore = await fs.readFile(path.join(__dirname, "core-rules.md"), "utf-8");
    }
    if (!cachedFinance) {
      cachedFinance = await fs.readFile(path.join(__dirname, "deductibles-and-finance.md"), "utf-8");
    }

    let lineSpecific = "";
    const relativeFile = LINE_GUIDANCE_MAP[businessLine];
    if (relativeFile) {
      if (!cachedLines.has(relativeFile)) {
        const content = await fs.readFile(path.join(__dirname, relativeFile), "utf-8");
        cachedLines.set(relativeFile, content);
      }
      lineSpecific = cachedLines.get(relativeFile);
    }

    return [
      "=== ULA CHARTERED ADJUSTER REPORTING GUIDANCE ===",
      cachedCore,
      "=== FINANCIAL & DEDUCTIBLE RULES ===",
      cachedFinance,
      lineSpecific ? `=== SPECIALIST LINE GUIDANCE: ${businessLine} ===\n${lineSpecific}` : "",
    ].filter(Boolean).join("\n\n");
  } catch (error) {
    console.error("Warning: Failed to load adjusting guidance:", error.message);
    return "";
  }
}
