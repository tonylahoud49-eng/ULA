import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
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
