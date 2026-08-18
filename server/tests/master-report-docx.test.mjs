import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createUnifiedReportDraft } from "../../src/lib/reportingEngine.js";
import { MASTER_TEMPLATE_NAME, populateMasterReportDocx } from "../../src/lib/masterReportDocx.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");

const textOf = (xml) => [...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1])
  .join("")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">");

async function airFixture() {
  const evidenceDirectory = path.join(root, "samples", "test-evidence", "air-cargo");
  const names = (await fs.readdir(evidenceDirectory)).sort();
  const evidence = await Promise.all(names.map(async (name, index) => ({
    document_id: `master-${index + 1}`,
    document_name: name,
    mime_type: "text/plain",
    extraction_status: "extracted",
    pages: [{ page: null, text: await fs.readFile(path.join(evidenceDirectory, name), "utf8") }],
  })));
  const documents = evidence.map((item) => ({ id: item.document_id, file_name: item.document_name, detected_categories: [] }));
  const claim = { claim_number: "ULA-MASTER-TEST-001", title: "Diagnostic analyzer transit damage", business_line: "Air Shipment (NET)" };
  const draft = createUnifiedReportDraft({ claim, documents, versions: [], generatedBy: "Test Writer", evidence });
  return { claim, draft };
}

test("DOCX export preserves the approved master structure and replaces only claim content", async () => {
  const { claim, draft } = await airFixture();
  const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
  const output = await populateMasterReportDocx(template, {
    claim,
    report: {
      normalized_claim_record: draft.normalizedRecord,
      assignments: draft.assignments,
      version_number: 2,
      notes: "Issued - Draft",
    },
    issueDate: "18 August 2026",
  });
  const archive = await JSZip.loadAsync(output);
  const documentXml = await archive.file("word/document.xml").async("string");
  const text = textOf(documentXml);
  const tables = [...documentXml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((match) => match[0]);
  const columnCounts = tables.map((table) => (table.match(/<w:gridCol\b/g) || []).length);

  assert.equal(MASTER_TEMPLATE_NAME, "260536 - CR - Victoire - UTA - 1v1.docx");
  assert.equal(tables.length, 7);
  assert.deepEqual(columnCounts, [1, 3, 3, 2, 2, 3, 4]);
  assert.equal((documentXml.match(/<w:sectPr\b/g) || []).length, 8);
  assert.match(documentXml, /<w:pgSz w:w="11906" w:h="16838"/);
  assert.match(documentXml, /<w:pgMar w:top="3005" w:right="1814" w:bottom="4536" w:left="1814"/);
  assert.match(text, /Document Control Page/);
  assert.match(text, /Report Summary/);
  assert.match(text, /Report and adjustment note/);
  assert.match(text, /INTEREST INSURED & RELEVANT CONDITIONS OF INSURANCE POLICY/);
  assert.match(text, /SURVEYOR NOTES/);
  assert.match(text, /CAUSE OF LOSS/);
  assert.match(text, /RELEVANT POLICY WARRANTIES & CONDITIONS/);
  assert.match(text, /CLAIM PRESENTED ON THE POLICY & ADJUSTMENT/);
  assert.match(text, /Enclosure to this report/);
  assert.match(text, /Outstanding\/ Not Available Documents/);
  assert.match(text, /POL-AIR-2026-8812/);
  assert.match(text, /774-9821-4402/);
  assert.match(text, /USD 39,700\.00/);
  assert.match(text, /Quantity damaged/);
  assert.match(text, /Unit Price in USD/);
  assert.match(text, /Adjusted Claim Value in USD/);
  assert.doesNotMatch(text, /\{\{[^}]+\}\}/);
  assert.doesNotMatch(text, /Victoire|Judi Lebanon|DamasGate|MC\/0002606|MSNU7244246|MEDULB209962|13,552\.80|Best Air|Wazen Trading|Bechara|HO-MAP-0103552/i);

  const footer = await archive.file("word/footer1.xml").async("string");
  const settings = await archive.file("word/settings.xml").async("string");
  assert.match(textOf(footer), /Date: 18 August 2026/);
  assert.match(footer, /<w:instrText[^>]*>\s*page\s*<\/w:instrText>/i);
  assert.match(footer, /<w:instrText[^>]*>\s*numpages\s*<\/w:instrText>/i);
  assert.match(settings, /<w:updateFields w:val="true"\/>/);
});

test("sanitized master contains no historical claim facts or claim photographs", async () => {
  const template = await fs.readFile(path.join(root, "samples", "templates", "ULA-Master-Report.docx"));
  const archive = await JSZip.loadAsync(template);
  let packageText = "";
  for (const name of Object.keys(archive.files).filter((item) => item.endsWith(".xml"))) packageText += await archive.file(name).async("string");
  const media = Object.keys(archive.files).filter((name) => name.startsWith("word/media/") && !archive.files[name].dir);

  assert.doesNotMatch(packageText, /Victoire|Judi Lebanon|DamasGate|MC\/0002606|MSNU7244246|MEDULB209962|13,552\.80|Best Air|Wazen Trading|Bechara|HO-MAP-0103552/i);
  assert.equal(media.length, 5);
  assert.ok(!media.some((name) => /image[4-7]\.(?:png|jpe?g)$/i.test(name)));
});
