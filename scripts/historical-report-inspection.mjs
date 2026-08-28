import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { extractEvidenceFile, evidenceText } from "../server/evidence/extractEvidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(process.argv.find((item) => item.startsWith("--manifest="))?.slice(11)
  || path.join(root, ".tmp", "historical-regression", "manifest.json"));
const outputRoot = path.join(root, ".tmp", "historical-regression", "local-inspection");

const decodeXml = (value) => String(value || "")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));

const paragraphText = (xml) => decodeXml([...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1]).join(""))
  .replace(/\s+/g, " ")
  .trim();

async function approvedReportText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((match) => ({
      text: paragraphText(match[0]),
      style: match[0].match(/<w:pStyle\s+w:val="([^"]+)"/i)?.[1] || "",
    }))
    .filter((item) => item.text)
    .map((item) => `${/heading|title/i.test(item.style) ? "## " : ""}${item.text}`)
    .join("\n");
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
await fs.mkdir(outputRoot, { recursive: true });
const inventory = [];

for (const [index, item] of manifest.cases.entries()) {
  const caseDirectory = path.join(outputRoot, item.case_id);
  await fs.mkdir(caseDirectory, { recursive: true });
  const sourcePath = path.resolve(item.source_document);
  const approvedPath = path.resolve(item.approved_report);
  const [sourceBuffer, approvedBuffer] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(approvedPath),
  ]);
  const evidence = await extractEvidenceFile({
    originalname: path.basename(sourcePath),
    mimetype: "application/pdf",
    size: sourceBuffer.length,
    buffer: sourceBuffer,
  }, {
    id: `${item.case_id}-source`,
    file_name: path.basename(sourcePath),
    category: "Other",
    index,
  });
  const [approvedText, sourceText] = await Promise.all([
    approvedReportText(approvedBuffer),
    Promise.resolve(evidenceText(evidence)),
  ]);
  await Promise.all([
    fs.writeFile(path.join(caseDirectory, "approved-report.txt"), `${approvedText}\n`),
    fs.writeFile(path.join(caseDirectory, "source-evidence.txt"), `${sourceText}\n`),
  ]);
  inventory.push({
    case_id: item.case_id,
    approved_report: path.basename(approvedPath),
    source_document: path.basename(sourcePath),
    approved_word_count: approvedText.split(/\s+/).filter(Boolean).length,
    source_word_count: sourceText.split(/\s+/).filter(Boolean).length,
    source_page_count: evidence.pages.length,
    searchable_page_count: evidence.searchable_page_count,
    image_only_page_count: evidence.image_only_page_count,
    visual_page_count: evidence.vision_image_count,
  });
  process.stdout.write(`[local] ${item.case_id}: extracted\n`);
}

await fs.writeFile(path.join(outputRoot, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(`[local] ${inventory.length}/${manifest.cases.length} pairs extracted without external API calls.\n`);
