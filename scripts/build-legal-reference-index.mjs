import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const argumentsList = process.argv.slice(2);
const outputFlag = argumentsList.indexOf("--output");
if (outputFlag < 0 || !argumentsList[outputFlag + 1]) {
  throw new Error("Usage: node scripts/build-legal-reference-index.mjs --output <index.json> <reference.pdf> [...]");
}
const outputPath = path.resolve(argumentsList[outputFlag + 1]);
const inputPaths = argumentsList.filter((_, index) => index !== outputFlag && index !== outputFlag + 1).map((item) => path.resolve(item));
if (!inputPaths.length) throw new Error("At least one local PDF reference is required.");

const titles = new Map([
  ["hudson.pdf", "Hudson: Marine Insurance Clauses (5th ed.)"],
  ["aaa-rules-of-practice-may-2022.pdf", "Association of Average Adjusters Rules of Practice (May 2022)"],
  ["ia 2015.pdf", "Insurance Act 2015"],
  ["mia 1906.pdf", "Marine Insurance Act 1906"],
  ["scrutton on charterparties and bills of lading.pdf", "Scrutton on Charterparties and Bills of Lading (24th ed.)"],
  ["gard guidance on maritime claims_final.pdf", "Gard Guidance on Maritime Claims"],
]);

const normalizeText = (items) => items
  .map((item) => String(item.str || "").trim())
  .filter(Boolean)
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();

function splitPageText(text, maximum = 4_000, overlap = 300) {
  if (text.length <= maximum) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maximum);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(maximum * 0.7)) end = boundary;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

const standardFontDataUrl = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
).replaceAll(path.sep, "/");
const wasmUrl = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/wasm/", import.meta.url),
).replaceAll(path.sep, "/");

const sources = [];
const chunks = [];
for (const inputPath of inputPaths) {
  const buffer = await fs.readFile(inputPath);
  const fileName = path.basename(inputPath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (sources.some((source) => source.sha256 === sha256)) {
    console.warn(`Skipping byte-identical duplicate reference: ${fileName}`);
    continue;
  }
  const sourceId = sha256.slice(0, 16);
  const normalizedFileName = fileName.toLowerCase().replace(/\s+\(\d+\)(?=\.pdf$)/, "");
  const title = titles.get(normalizedFileName) || path.basename(fileName, path.extname(fileName));
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    standardFontDataUrl,
    wasmUrl,
  }).promise;
  let searchablePages = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = normalizeText((await page.getTextContent()).items);
    if (!text) continue;
    searchablePages += 1;
    splitPageText(text).forEach((chunkText, index) => chunks.push({
      source_id: sourceId,
      title,
      page: pageNumber,
      chunk_index: index + 1,
      text: chunkText,
    }));
  }
  sources.push({
    source_id: sourceId,
    title,
    file_name: fileName,
    sha256,
    bytes: buffer.length,
    pages: document.numPages,
    searchable_pages: searchablePages,
  });
}

const index = {
  version: 1,
  generated_at: new Date().toISOString(),
  source_role: "legal_reference_only",
  rules: [
    "References are legal knowledge only and are never claim evidence.",
    "Only claim documents may support claim-specific facts, values, dates, parties, findings, and calculations.",
    "Legal excerpts may identify review issues but cannot determine coverage or liability without professional review.",
  ],
  sources,
  chunks,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(index));
console.log(JSON.stringify({
  output: outputPath,
  source_count: sources.length,
  page_count: sources.reduce((total, source) => total + source.pages, 0),
  searchable_page_count: sources.reduce((total, source) => total + source.searchable_pages, 0),
  chunk_count: chunks.length,
  serialized_bytes: Buffer.byteLength(JSON.stringify(index)),
}, null, 2));
