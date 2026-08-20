import crypto from "node:crypto";
import { CLAIM_FIELDS } from "../ai/claimAnalysisSchema.mjs";

const CLAIM_CONTEXT_FIELDS = new Set([
  "id",
  "claim_number",
  "title",
  "business_line",
  "status",
  "priority",
  ...CLAIM_FIELDS,
]);

const normalizedFingerprint = (value) => String(value || "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .replace(/[|_~]+/g, " ")
  .trim();

const bufferHash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function isIrrelevantLine(line) {
  const normalized = normalizedFingerprint(line);
  if (!normalized) return true;
  if (/^(?:page\s*)?\d+\s*(?:of|\/)\s*\d+$/i.test(normalized)) return true;
  if (/^[-–—_=*•·.\s]{3,}$/.test(normalized)) return true;
  return false;
}

function cleanPageText(text, seenLines) {
  const retained = [];
  let duplicateLines = 0;
  let irrelevantLines = 0;
  for (const sourceLine of String(text || "").split(/\r?\n/)) {
    const line = sourceLine.replace(/[ \t]+/g, " ").trim();
    if (isIrrelevantLine(line)) {
      irrelevantLines += 1;
      continue;
    }
    const fingerprint = normalizedFingerprint(line);
    if (fingerprint.length >= 12 && seenLines.has(fingerprint)) {
      duplicateLines += 1;
      continue;
    }
    if (fingerprint.length >= 12) seenLines.add(fingerprint);
    retained.push(line);
  }
  return { text: retained.join("\n").trim(), duplicateLines, irrelevantLines };
}

export function prepareClaimContextForAnthropic(claim = {}) {
  return Object.fromEntries(Object.entries(claim).flatMap(([key, value]) => {
    if (!CLAIM_CONTEXT_FIELDS.has(key) || value === undefined || value === null || value === "") return [];
    if (["string", "number", "boolean"].includes(typeof value)) {
      return [[key, typeof value === "string" ? value.slice(0, 2_000) : value]];
    }
    return [];
  }));
}

export function prepareEvidenceForAnthropic(evidence = []) {
  const seenDocumentText = new Map();
  const seenEmbeddedImages = new Set();
  const seenVisionImages = new Set();
  const stats = {
    original_text_characters: 0,
    retained_text_characters: 0,
    blank_pages_removed: 0,
    duplicate_pages_removed: 0,
    duplicate_lines_removed: 0,
    irrelevant_lines_removed: 0,
    duplicate_images_removed: 0,
  };

  const preparedEvidence = evidence.map((item) => {
    const seenLines = new Set();
    const seenPages = new Set();
    const pages = [];
    const originalDocumentText = (item.pages || []).map((page) => String(page.text || "")).join("\n");
    stats.original_text_characters += originalDocumentText.length;
    const documentFingerprint = normalizedFingerprint(originalDocumentText);
    const duplicateDocument = documentFingerprint.length >= 40 ? seenDocumentText.get(documentFingerprint) : null;
    if (!duplicateDocument && documentFingerprint.length >= 40) {
      seenDocumentText.set(documentFingerprint, item.document_name);
    }

    if (duplicateDocument) {
      pages.push({
        page: null,
        section: "Local deduplication",
        text: `Duplicate extracted content omitted locally; identical to ${duplicateDocument}.`,
      });
      stats.duplicate_pages_removed += item.pages?.filter((page) => page.text).length || 0;
    } else {
      for (const page of item.pages || []) {
        const cleaned = cleanPageText(page.text, seenLines);
        stats.duplicate_lines_removed += cleaned.duplicateLines;
        stats.irrelevant_lines_removed += cleaned.irrelevantLines;
        if (!cleaned.text) {
          if (!item.vision_images?.some((image) => image.page === page.page)) stats.blank_pages_removed += 1;
          continue;
        }
        const pageFingerprint = normalizedFingerprint(cleaned.text);
        if (pageFingerprint.length >= 40 && seenPages.has(pageFingerprint)) {
          stats.duplicate_pages_removed += 1;
          continue;
        }
        if (pageFingerprint.length >= 40) seenPages.add(pageFingerprint);
        pages.push({ ...page, text: cleaned.text, raw_text: undefined });
        stats.retained_text_characters += cleaned.text.length;
      }
    }

    const embeddedImages = (item.embedded_images || []).filter((image) => {
      const fingerprint = bufferHash(image.buffer);
      if (seenEmbeddedImages.has(fingerprint)) {
        stats.duplicate_images_removed += 1;
        return false;
      }
      seenEmbeddedImages.add(fingerprint);
      return true;
    });
    const visionImages = (item.vision_images || []).filter((image) => {
      const fingerprint = bufferHash(image.buffer);
      if (seenVisionImages.has(fingerprint)) {
        stats.duplicate_images_removed += 1;
        return false;
      }
      seenVisionImages.add(fingerprint);
      return true;
    });
    return {
      ...item,
      pages,
      embedded_images: embeddedImages,
      embedded_image_count: embeddedImages.length,
      vision_images: visionImages,
      vision_image_count: visionImages.length,
    };
  });

  return { evidence: preparedEvidence, stats };
}
