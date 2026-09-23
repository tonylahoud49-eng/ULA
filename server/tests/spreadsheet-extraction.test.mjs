import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { extractEvidenceFile } from "../evidence/extractEvidence.mjs";

function workbookBytes(bookType) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Item", "Amount"], ["Equipment", 1250.25]]), "Inventory");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Note"], ["Second sheet evidence"]]), "Notes");
  return XLSX.write(workbook, { type: "buffer", bookType });
}

async function extract(buffer, name) {
  return extractEvidenceFile({ originalname: name, buffer, size: buffer.length }, { id: "spreadsheet" });
}

test("legacy XLS extraction retains every worksheet and source amounts", async () => {
  const result = await extract(workbookBytes("biff8"), "inventory.xls");
  assert.equal(result.extraction_status, "extracted");
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].text, /Equipment,1250.25/);
  assert.match(result.pages[1].text, /Second sheet evidence/);
});

test("valid XLSX with a large worksheet preamble survives primary-reader chunk failure", async () => {
  const zip = await JSZip.loadAsync(workbookBytes("xlsx"));
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.file("xl/worksheets/sheet1.xml", sheet.replace("<sheetData>", `<!--${"padding".repeat(12000)}--><sheetData>`));
  const result = await extract(await zip.generateAsync({ type: "nodebuffer" }), "branches.xlsx");
  assert.equal(result.extraction_status, "extracted");
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].text, /Equipment,1250.25/);
});

test("invalid spreadsheet bytes remain explicitly excluded", async () => {
  const result = await extract(Buffer.from("not a workbook"), "broken.xlsx");
  assert.equal(result.extraction_status, "unsupported");
  assert.equal(result.pages.length, 0);
});
