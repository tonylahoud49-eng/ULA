import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import readXlsxFile from "read-excel-file/node";
import { simpleParser } from "mailparser";

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".rtf"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_SEARCHABLE_VISUAL_PAGES = 24;
const MAX_PDF_PAGES = Number.isFinite(Number(process.env.AI_MAX_PDF_PAGES))
  ? Math.max(1, Math.floor(Number(process.env.AI_MAX_PDF_PAGES)))
  : 80;
const MAX_PDF_VISION_PAGES = Number.isFinite(Number(process.env.AI_MAX_PDF_VISION_PAGES))
  ? Math.max(1, Math.floor(Number(process.env.AI_MAX_PDF_VISION_PAGES)))
  : 40;
const MAX_ANTHROPIC_NATIVE_PDF_BYTES = Number.isFinite(Number(process.env.ANTHROPIC_NATIVE_PDF_MAX_BYTES))
  ? Math.max(1, Math.floor(Number(process.env.ANTHROPIC_NATIVE_PDF_MAX_BYTES)))
  : 8 * 1024 * 1024;
const SPARSE_SEARCHABLE_PAGE_CHARACTERS = 32;
const MAX_ANTHROPIC_MANY_IMAGE_DIMENSION = 1_900;
const MATERIAL_RASTER_MIN_WIDTH = 180;
const MATERIAL_RASTER_MIN_HEIGHT = 180;
const MATERIAL_RASTER_MIN_AREA = 80_000;
const normalizeWhitespace = (value) => String(value || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export class EvidenceExtractionError extends Error {
  constructor(message, { status = 422, code = "evidence-extraction-failed" } = {}) {
    super(message);
    this.name = "EvidenceExtractionError";
    this.status = status;
    this.code = code;
  }
}

const pdfPageText = (items = []) => {
  const populated = items.filter((item) => String(item.str || "").trim());
  const rawText = normalizeWhitespace(populated.map((item) => item.str).join(" "));
  const lines = [];

  for (const item of populated) {
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text: String(item.str).trim() });
  }

  const layoutText = normalizeWhitespace(lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(" "))
    .join("\n"));

  return {
    text: layoutText || rawText,
    raw_text: rawText && rawText !== layoutText ? rawText : undefined,
    extraction_status: layoutText || rawText ? "extracted" : "image-only",
  };
};

const xmlText = (xml) => normalizeWhitespace(
  String(xml || "")
    .replace(/<w:tab\s*\/?>/gi, "\t")
    .replace(/<w:br\s*\/?>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"),
);

async function renderPdfPageForVision(page, pageNumber, {
  maxDimension = MAX_ANTHROPIC_MANY_IMAGE_DIMENSION,
  jpegQuality = 72,
} = {}) {
  const preferredScale = 1.25;
  const preferredViewport = page.getViewport({ scale: preferredScale });
  const largestPreferredDimension = Math.max(preferredViewport.width, preferredViewport.height);
  const boundedScale = largestPreferredDimension > maxDimension
    ? preferredScale * maxDimension / largestPreferredDimension
    : preferredScale;
  const viewport = page.getViewport({ scale: boundedScale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let sampled = 0;
  let nonBlank = 0;
  for (let index = 0; index < pixels.length; index += 4 * 16) {
    sampled += 1;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (red < 242 || green < 242 || blue < 242) nonBlank += 1;
  }
  if (!sampled || nonBlank / sampled < 0.001) return null;
  return {
    page: pageNumber,
    mime_type: "image/jpeg",
    buffer: canvas.toBuffer("image/jpeg", jpegQuality),
  };
}

export function visionRenderOptionsForSelectedPages(selectedPageCount) {
  if (selectedPageCount > 20) return { maxDimension: 900, jpegQuality: 48 };
  if (selectedPageCount > 12) return { maxDimension: 1_200, jpegQuality: 60 };
  return undefined;
}

const rasterDimensions = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    const direct = [];
    for (let index = 0; index < value.length - 1; index += 1) {
      const width = Number(value[index]);
      const height = Number(value[index + 1]);
      if (Number.isFinite(width) && Number.isFinite(height)) direct.push({ width, height });
    }
    return [...direct, ...value.flatMap(rasterDimensions)];
  }
  if (typeof value !== "object") return [];
  const width = Number(value.width);
  const height = Number(value.height);
  const current = Number.isFinite(width) && Number.isFinite(height) ? [{ width, height }] : [];
  return [...current, ...Object.values(value).flatMap(rasterDimensions)];
};

async function pdfPageHasMaterialRaster(page, operations) {
  const operatorList = await page.getOperatorList();
  const imageOperators = new Set([
    operations.paintImageXObject,
    operations.paintInlineImageXObject,
    operations.paintImageMaskXObject,
    operations.paintSolidColorImageMask,
  ].filter(Number.isFinite));
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    if (!imageOperators.has(operatorList.fnArray[index])) continue;
    const dimensions = rasterDimensions(operatorList.argsArray[index]);
    if (dimensions.some(({ width, height }) => width >= MATERIAL_RASTER_MIN_WIDTH
      && height >= MATERIAL_RASTER_MIN_HEIGHT
      && width * height >= MATERIAL_RASTER_MIN_AREA)) return true;
  }
  return false;
}

async function extractPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = fileURLToPath(
    new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
  ).replaceAll(path.sep, "/");
  const wasmUrl = fileURLToPath(
    new URL("../../node_modules/pdfjs-dist/wasm/", import.meta.url),
  ).replaceAll(path.sep, "/");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, standardFontDataUrl, wasmUrl });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new EvidenceExtractionError(
        `PDF has ${pdf.numPages} pages; split it into files of at most ${MAX_PDF_PAGES} pages before analysis.`,
        { status: 413, code: "pdf-page-limit" },
      );
    }
    const pages = [];
    const visionImages = [];
    const searchableVisualCandidates = [];
    const imageOnlyPages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const extracted = { page: pageNumber, ...pdfPageText(content.items) };
        pages.push(extracted);
        const imageOnly = !extracted.text;
        if (imageOnly) {
          imageOnlyPages.push(pageNumber);
        } else if (await pdfPageHasMaterialRaster(page, pdfjs.OPS)) {
          const textLength = extracted.text.length;
          const sparseText = textLength <= SPARSE_SEARCHABLE_PAGE_CHARACTERS;
          const materialClaimTerms = (extracted.text.match(/\b(?:survey|statement of facts|inspection|damage|damaged|deteriorat|temperature|logger|photograph|container|customs|claim)\b/gi) || []).length;
          searchableVisualCandidates.push({
            pageNumber,
            sparseText,
            // Rank the complete document before applying the cap. Otherwise early
            // OCR policy scans can hide later SOFs, logger screens, and photographs.
            priority: (sparseText ? 1_000_000 : 0) + materialClaimTerms * 10_000 - textLength,
          });
        }
      } finally {
        page.cleanup();
      }
    }

    const selectedSearchableVisualPages = searchableVisualCandidates
      .sort((left, right) => right.priority - left.priority || left.pageNumber - right.pageNumber)
      .slice(0, MAX_SEARCHABLE_VISUAL_PAGES);
    const selectedPages = [
      ...imageOnlyPages.map((pageNumber) => ({ pageNumber, reason: "image-only" })),
      ...selectedSearchableVisualPages.map((candidate) => ({
        pageNumber: candidate.pageNumber,
        reason: candidate.sparseText ? "sparse-searchable-visual" : "material-raster-with-searchable-text",
      })),
    ].sort((left, right) => left.pageNumber - right.pageNumber);
    if (selectedPages.length > MAX_PDF_VISION_PAGES) {
      throw new EvidenceExtractionError(
        `PDF contains ${selectedPages.length} pages requiring visual review; split it into files with at most ${MAX_PDF_VISION_PAGES} visual pages before analysis.`,
        { status: 413, code: "pdf-vision-page-limit" },
      );
    }

    // Claude natively understands PDFs. For a large scanned bundle, sending
    // the original PDF is safer and more complete than rasterizing every page
    // in-process; local page text remains available for citation verification.
    if (selectedPages.length > MAX_SEARCHABLE_VISUAL_PAGES
      && buffer.length <= MAX_ANTHROPIC_NATIVE_PDF_BYTES) {
      return { pages, visionImages, nativePdf: true };
    }

    // A complete evidence set is retained, but a large scanned bundle must use
    // a smaller raster for each page. This prevents native canvas allocations
    // from accumulating across dozens of pages before Claude receives them.
    const visionRenderOptions = visionRenderOptionsForSelectedPages(selectedPages.length);

    for (const selected of selectedPages) {
      const page = await pdf.getPage(selected.pageNumber);
      try {
        const rendered = await renderPdfPageForVision(page, selected.pageNumber, visionRenderOptions);
        if (rendered) visionImages.push({ ...rendered, vision_reason: selected.reason });
      } finally {
        page.cleanup();
      }
    }
    return { pages, visionImages, nativePdf: false };
  } finally {
    await task.destroy();
  }
}

async function extractDocx(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const documentXml = archive.file("word/document.xml");
  if (!documentXml) throw new Error("The DOCX package does not contain word/document.xml.");
  const embeddedImages = [];
  const imageMimeTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
  for (const item of Object.values(archive.files)) {
    const extension = path.extname(item.name).toLowerCase();
    if (item.dir || !item.name.startsWith("word/media/") || !imageMimeTypes[extension]) continue;
    embeddedImages.push({
      name: path.basename(item.name),
      mime_type: imageMimeTypes[extension],
      buffer: await item.async("nodebuffer"),
    });
  }
  return {
    pages: [{ page: null, text: xmlText(await documentXml.async("string")) }],
    embeddedImages,
  };
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

async function extractWorkbook(buffer) {
  const sheets = await readXlsxFile(buffer, { parseNumber: (value) => value });
  return sheets.map((worksheet) => ({
    page: null,
    section: `Worksheet: ${worksheet.sheet}`,
    text: normalizeWhitespace(worksheet.data.map((row) =>
      Array.isArray(row) ? row.map((value) => csvCell(value instanceof Date ? value.toISOString() : value)).join(",") : "",
    ).filter(Boolean).join("\n")),
  }));
}

async function extractEmail(buffer) {
  const message = await simpleParser(buffer);
  const headers = [
    `From: ${message.from?.text || ""}`,
    `To: ${message.to?.text || ""}`,
    `Subject: ${message.subject || ""}`,
    `Date: ${message.date?.toISOString?.() || ""}`,
  ].join("\n");
  return [{ page: null, text: normalizeWhitespace(`${headers}\n\n${message.text || message.html || ""}`) }];
}

export async function extractEvidenceFile(file, metadata = {}) {
  const extension = path.extname(file.originalname || metadata.file_name || "").toLowerCase();
  const mimeType = String(file.mimetype || metadata.file_mime_type || "application/octet-stream").toLowerCase();
  const base = {
    document_id: String(metadata.id || `document-${metadata.index ?? 0}`),
    document_name: metadata.file_name || file.originalname || "document",
    mime_type: mimeType,
    category: metadata.category || metadata.file_type || "Other",
    size: file.size,
  };

  try {
    if (mimeType === "application/pdf" || extension === ".pdf") {
      const { pages, visionImages, nativePdf } = await extractPdf(file.buffer);
      const searchablePageCount = pages.filter((page) => page.text).length;
      return {
        ...base,
        kind: "pdf",
        pages,
        searchable_page_count: searchablePageCount,
        image_only_page_count: pages.length - searchablePageCount,
        vision_images: visionImages,
        vision_image_count: visionImages.length,
        native_pdf: nativePdf,
        extraction_status: searchablePageCount ? "extracted" : "vision-required",
      };
    }
    if (mimeType.includes("wordprocessingml") || extension === ".docx") {
      const extracted = await extractDocx(file.buffer);
      return {
        ...base,
        kind: "document",
        pages: extracted.pages,
        embedded_images: extracted.embeddedImages,
        embedded_image_count: extracted.embeddedImages.length,
        extraction_status: extracted.pages[0].text || extracted.embeddedImages.length ? "extracted" : "vision-required",
      };
    }
    if (mimeType.includes("spreadsheetml") || extension === ".xlsx") {
      return { ...base, kind: "spreadsheet", pages: await extractWorkbook(file.buffer), extraction_status: "extracted" };
    }
    if (mimeType === "message/rfc822" || extension === ".eml") {
      return { ...base, kind: "email", pages: await extractEmail(file.buffer), extraction_status: "extracted" };
    }
    if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
      return { ...base, kind: "image", pages: [], extraction_status: "vision-required" };
    }
    if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) {
      return { ...base, kind: "text", pages: [{ page: null, text: normalizeWhitespace(file.buffer.toString("utf8")) }], extraction_status: "extracted" };
    }
    return { ...base, kind: "unsupported", pages: [], extraction_status: "unsupported", warning: `No text extractor is configured for ${extension || mimeType}.` };
  } catch (error) {
    return {
      ...base,
      kind: mimeType.startsWith("image/") ? "image" : "unreadable",
      pages: [],
      extraction_status: "failed",
      warning: error.message || "Evidence extraction failed.",
      error_status: Number(error.status) || 500,
      error_code: error.code || "evidence-extraction-failed",
    };
  }
}

export function evidenceText(evidence) {
  return evidence.pages
    .filter((part) => part.text)
    .map((part) => `${part.page ? `[Page ${part.page}]` : part.section ? `[${part.section}]` : "[Extracted text]"}\n${part.text}`)
    .join("\n\n");
}
