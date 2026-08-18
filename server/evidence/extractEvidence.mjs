import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import JSZip from "jszip";
import readXlsxFile from "read-excel-file/node";
import { simpleParser } from "mailparser";

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".rtf"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const normalizeWhitespace = (value) => String(value || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

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

async function renderPdfPageForVision(page, pageNumber) {
  const viewport = page.getViewport({ scale: 1.25 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return {
    page: pageNumber,
    mime_type: "image/jpeg",
    buffer: canvas.toBuffer("image/jpeg", 72),
  };
}

async function extractPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = fileURLToPath(
    new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
  ).replaceAll(path.sep, "/");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, standardFontDataUrl });
  const pdf = await task.promise;
  const pages = [];
  const visionImages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const extracted = { page: pageNumber, ...pdfPageText(content.items) };
    pages.push(extracted);
    if (!extracted.text) visionImages.push(await renderPdfPageForVision(page, pageNumber));
  }
  return { pages, visionImages };
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
      const { pages, visionImages } = await extractPdf(file.buffer);
      const searchablePageCount = pages.filter((page) => page.text).length;
      return {
        ...base,
        kind: "pdf",
        pages,
        searchable_page_count: searchablePageCount,
        image_only_page_count: pages.length - searchablePageCount,
        vision_images: visionImages,
        vision_image_count: visionImages.length,
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
    return { ...base, kind: mimeType.startsWith("image/") ? "image" : "unreadable", pages: [], extraction_status: "failed", warning: error.message || "Evidence extraction failed." };
  }
}

export function evidenceText(evidence) {
  return evidence.pages
    .filter((part) => part.text)
    .map((part) => `${part.page ? `[Page ${part.page}]` : part.section ? `[${part.section}]` : "[Extracted text]"}\n${part.text}`)
    .join("\n\n");
}
