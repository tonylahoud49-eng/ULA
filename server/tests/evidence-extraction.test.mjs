import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { jsPDF } from "jspdf";
import { extractEvidenceFile, evidenceText } from "../evidence/extractEvidence.mjs";

const file = (name, mimeType, buffer) => ({ originalname: name, mimetype: mimeType, buffer, size: buffer.length });

async function docxBuffer() {
  const archive = new JSZip();
  archive.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CLAIM FORM Policy No POL-44 Date of Loss 12 May 2026</w:t></w:r></w:p></w:body></w:document>`);
  return archive.generateAsync({ type: "nodebuffer" });
}

async function xlsxBuffer() {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  archive.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  archive.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Claim Ledger" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  archive.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  archive.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Invoice Number</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>INV-2048</t></is></c><c r="B2"><v>128450</v></c></row></sheetData></worksheet>`);
  return archive.generateAsync({ type: "nodebuffer" });
}

test("server extraction reads PDF, DOCX, XLSX, and email contents and routes images to vision", async () => {
  const pdf = new jsPDF();
  pdf.text("Insurance Policy Number POL-44", 20, 20);
  const pdfEvidence = await extractEvidenceFile(
    file("policy.pdf", "application/pdf", Buffer.from(pdf.output("arraybuffer"))),
    { id: "pdf-1" },
  );
  assert.match(evidenceText(pdfEvidence), /Insurance Policy Number POL-44/i);
  assert.equal(pdfEvidence.kind, "pdf");
  assert.equal(pdfEvidence.searchable_page_count, 1);
  assert.equal(pdfEvidence.image_only_page_count, 0);
  assert.equal(pdfEvidence.pages[0].extraction_status, "extracted");

  const wordEvidence = await extractEvidenceFile(
    file("combined.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await docxBuffer()),
    { id: "word-1" },
  );
  assert.match(evidenceText(wordEvidence), /CLAIM FORM Policy No POL-44/i);

  const sheetEvidence = await extractEvidenceFile(
    file("invoice.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await xlsxBuffer()),
    { id: "sheet-1" },
  );
  assert.match(evidenceText(sheetEvidence), /Invoice Number,Amount/i);
  assert.match(evidenceText(sheetEvidence), /INV-2048,128450/i);

  const email = Buffer.from("From: adjuster@example.test\r\nTo: claims@example.test\r\nSubject: Notice of Claim\r\nDate: Tue, 12 May 2026 10:00:00 +0000\r\n\r\nPlease register the cargo water damage claim.");
  const emailEvidence = await extractEvidenceFile(file("notice.eml", "message/rfc822", email), { id: "email-1" });
  assert.match(evidenceText(emailEvidence), /Notice of Claim/i);
  assert.match(evidenceText(emailEvidence), /cargo water damage/i);

  const imageEvidence = await extractEvidenceFile(file("damage.jpg", "image/jpeg", Buffer.from([1, 2, 3])), { id: "image-1" });
  assert.equal(imageEvidence.extraction_status, "vision-required");
  assert.equal(imageEvidence.kind, "image");
});

test("image-only pages inside a mixed PDF are rendered and retained for provider vision", async () => {
  const source = createCanvas(900, 1200);
  const context = source.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = "black";
  context.font = "bold 48px sans-serif";
  context.fillText("TOTAL CLAIM USD 10,859.57", 80, 180);
  context.font = "34px sans-serif";
  context.fillText("Container SEKU9137702", 80, 260);

  const pdf = new jsPDF({ unit: "px", format: [900, 1200] });
  pdf.addImage(source.toDataURL("image/jpeg", 0.82), "JPEG", 0, 0, 900, 1200);
  const evidence = await extractEvidenceFile(
    file("combined-claim.pdf", "application/pdf", Buffer.from(pdf.output("arraybuffer"))),
    { id: "mixed-scan" },
  );

  assert.equal(evidence.pages.length, 1);
  assert.equal(evidence.pages[0].extraction_status, "image-only");
  assert.equal(evidence.image_only_page_count, 1);
  assert.equal(evidence.vision_image_count, 1);
  assert.equal(evidence.vision_images[0].page, 1);
  assert.equal(evidence.vision_images[0].mime_type, "image/jpeg");
  assert.ok(evidence.vision_images[0].buffer.length > 1_000);
});

test("searchable PDF pages with material photographs are also retained for provider vision", async () => {
  const photograph = createCanvas(640, 480);
  const photographContext = photograph.getContext("2d");
  photographContext.fillStyle = "#744f3a";
  photographContext.fillRect(0, 0, photograph.width, photograph.height);
  photographContext.fillStyle = "#d9c3a5";
  photographContext.fillRect(90, 80, 460, 310);

  const pdf = new jsPDF({ unit: "px", format: [900, 1200] });
  pdf.text("SURVEY PHOTOGRAPHS - damaged packing at delivery", 50, 70);
  pdf.addImage(photograph.toDataURL("image/jpeg", 0.82), "JPEG", 120, 140, 640, 480);
  const evidence = await extractEvidenceFile(
    file("survey-with-captioned-photo.pdf", "application/pdf", Buffer.from(pdf.output("arraybuffer"))),
    { id: "captioned-photo" },
  );

  assert.equal(evidence.searchable_page_count, 1);
  assert.equal(evidence.image_only_page_count, 0);
  assert.equal(evidence.vision_image_count, 1);
  assert.equal(evidence.vision_images[0].page, 1);
  assert.equal(evidence.vision_images[0].vision_reason, "material-raster-with-searchable-text");
});

test("oversized PDF pages are bounded for Anthropic many-image requests", async () => {
  const source = createCanvas(2_400, 3_000);
  const context = source.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = "black";
  context.font = "bold 96px sans-serif";
  context.fillText("MATERIAL CLAIM PHOTOGRAPH", 120, 260);

  const pdf = new jsPDF({ unit: "px", format: [2_400, 3_000] });
  pdf.addImage(source.toDataURL("image/jpeg", 0.8), "JPEG", 0, 0, 2_400, 3_000);
  const evidence = await extractEvidenceFile(
    file("oversized-visual-page.pdf", "application/pdf", Buffer.from(pdf.output("arraybuffer"))),
    { id: "oversized-visual" },
  );
  const rendered = await loadImage(evidence.vision_images[0].buffer);

  assert.ok(Math.max(rendered.width, rendered.height) <= 1_900);
  assert.ok(rendered.width > 0 && rendered.height > 0);
});

test("later sparse OCR visual pages are not hidden by earlier searchable scans", async () => {
  const scan = createCanvas(400, 300);
  const scanContext = scan.getContext("2d");
  scanContext.fillStyle = "#f4f0e8";
  scanContext.fillRect(0, 0, scan.width, scan.height);
  scanContext.fillStyle = "#321f19";
  scanContext.fillRect(45, 45, 310, 210);

  const pdf = new jsPDF({ unit: "px", format: [500, 650] });
  for (let pageNumber = 1; pageNumber <= 25; pageNumber += 1) {
    if (pageNumber > 1) pdf.addPage([500, 650], "portrait");
    pdf.addImage(scan.toDataURL("image/jpeg", 0.78), "JPEG", 50, 130, 400, 300);
    pdf.text(pageNumber === 25
      ? "CamScanner"
      : `Policy scan page ${pageNumber} with searchable wording and ordinary policy conditions`, 40, 70);
  }

  const evidence = await extractEvidenceFile(
    file("combined-policy-and-survey.pdf", "application/pdf", Buffer.from(pdf.output("arraybuffer"))),
    { id: "late-sparse-survey" },
  );

  assert.equal(evidence.vision_image_count, 24);
  assert.ok(evidence.vision_images.some((image) => image.page === 25));
  assert.equal(evidence.vision_images.find((image) => image.page === 25).vision_reason, "sparse-searchable-visual");
});
