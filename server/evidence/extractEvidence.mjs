import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import readXlsxFile from "read-excel-file/node";
import { simpleParser } from "mailparser";

const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".rtf"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const normalizeWhitespace = (value) => String(value || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

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

async function extractPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl = fileURLToPath(
    new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
  ).replaceAll(path.sep, "/");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, standardFontDataUrl });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({
      page: pageNumber,
      text: normalizeWhitespace(content.items.map((item) => item.str || "").join(" ")),
    });
  }
  return pages;
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
      const pages = await extractPdf(file.buffer);
      return { ...base, kind: "pdf", pages, extraction_status: pages.some((page) => page.text) ? "extracted" : "vision-required" };
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
