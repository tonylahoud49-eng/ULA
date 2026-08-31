import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";

const source = process.argv[2];
const destination = process.argv[3] || "samples/templates/ULA-Master-Report.docx";
if (!source) throw new Error("Usage: node scripts/build-master-report-template.mjs <reference.docx> [output.docx]");

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const textOf = (xml) => [...String(xml || "").matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((match) => match[1]).join("")
  .replace(/\s+/g, " ")
  .trim();

function replaceBlockText(xml, value) {
  const encoded = escapeXml(value);
  let replaced = false;
  const updated = xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, (textNode) => {
    if (replaced) return textNode.replace(/>[^<]*<\/w:t>$/, "></w:t>");
    replaced = true;
    return textNode.replace(/>[^<]*<\/w:t>$/, `>${encoded}</w:t>`);
  });
  if (replaced) return updated;
  return updated.replace(/<\/w:p>$/, `<w:r><w:t>${encoded}</w:t></w:r></w:p>`);
}

function rowsOf(table) {
  return [...table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((match) => match[0]);
}

function replaceCells(row, values) {
  let index = 0;
  return row.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => {
    const value = values[index];
    index += 1;
    return value === undefined ? cell : replaceBlockText(cell, value);
  });
}

function replaceTableRows(table, rows) {
  const first = table.search(/<w:tr\b/);
  const matches = [...table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
  if (first < 0 || !matches.length) return table;
  const last = matches.at(-1);
  return `${table.slice(0, first)}${rows.join("")}${table.slice(last.index + last[0].length)}`;
}

function transformTable(table, index) {
  const rows = rowsOf(table);
  if (index === 2) {
    rows[1] = replaceCells(rows[1], ["{{preparer_name}}", "{{reviewer_name}}", "{{approver_name}}"]);
    rows[3] = replaceCells(rows[3], ["{{preparer_designation}}", "{{reviewer_designation}}", "{{approver_designation}}"]);
    rows[7] = replaceCells(rows[7], ["{{approval_date}}"]);
  } else if (index === 3) {
    rows[1] = replaceCells(rows[1], ["{{version_number}}", "{{issue_date}}", "{{revision_reason}}"]);
  } else if (index === 4) {
    rows[0] = replaceCells(rows[0], ["Assured's / Shipper's Name", "{{summary_assured}}"]);
    rows[1] = replaceCells(rows[1], ["Consignee's Name", "{{summary_consignee}}"]);
    rows[2] = replaceCells(rows[2], ["Insurance Policy", "{{summary_policy}}"]);
  } else if (index === 5) {
    const values = [
      ["Applicant's Name", "{{insurer}}"],
      ["Assured's Name", "{{insured_name}}"],
      ["Insurance Policy", "{{policy_details}}"],
      ["Incoterm / Terms of sale", "{{incoterm}}"],
      ["Transport Document", "{{transport_document}}"],
      ["Shipper's Name", "{{shipper}}"],
      ["Consignee's Name", "{{consignee}}"],
      ["Cargo / Commodities", "{{cargo_details}}"],
      ["Origin / Destination", "{{routing_details}}"],
      ["Carrying Vessel / Carrier", "{{carrier_details}}"],
      ["Cargo Arrival / Delivery Date", "{{arrival_delivery_details}}"],
    ];
    values.forEach((value, rowIndex) => { rows[rowIndex] = replaceCells(rows[rowIndex], value); });
  } else if (index === 6) {
    rows[0] = replaceCells(rows[0], ["Description", "Boxes / Quantity", "Packing"]);
    rows[1] = replaceCells(rows[1], ["{{damage_description}}", "{{damage_quantity}}", "{{damage_packing}}"]);
    return replaceTableRows(table, rows.slice(0, 2));
  } else if (index === 7) {
    rows[0] = replaceCells(rows[0], ["Description", "Quantity damaged", "Unit Price in {{currency}}", "Adjusted Claim Value in {{currency}}"]);
    rows[1] = replaceCells(rows[1], ["{{adjustment_description}}", "{{adjustment_quantity}}", "{{adjustment_unit_price}}", "{{adjustment_value}}"]);
    rows[18] = replaceCells(rows[18], ["{{adjustment_total}}"]);
    return replaceTableRows(table, [rows[0], rows[1], rows[18]]);
  }
  return replaceTableRows(table, rows);
}

const paragraphReplacements = new Map([
  [1, "{{cover_title}}"],
  [3, "ULA reference: {{claim_number}} - {{version_number}}v1"],
  [4, "Applicant's Name: {{insurer}}"],
  [5, "Assured's Name: {{insured_name}}"],
  [6, "Policy No.: {{policy_number}}"],
  [7, "{{issue_date}}"],
  [20, "{{report_summary_intro}}"],
  [22, "{{report_summary_findings}}"],
  [32, "{{report_summary_opinion}}"],
  [36, "{{document_sighting}}"],
  [38, "{{report_note_intro}}"],
  [41, "{{interest_insured}}"],
  [43, "{{surveyor_notes}}"],
  [62, "{{cause_of_loss_section}}"],
  [64, "{{policy_conditions_section}}"],
  [70, "{{adequacy_section}}"],
  [72, "{{assessors_section}}"],
  [74, "{{adjustment_intro}}"],
  [78, "{{conclusion_items}}"],
  [95, "{{enclosure_items}}"],
  [111, "{{outstanding_items}}"],
  [116, "{{appendices}}"],
  [117, "{{appendix_image}}"],
  [166, "{{contact_details}}"],
]);

const removedParagraphRanges = [
  [23, 30], [33, 35], [44, 60], [65, 68], [79, 89], [96, 106], [112, 114], [118, 128],
];
const removeParagraph = (index) => removedParagraphRanges.some(([start, end]) => index >= start && index <= end);

const archive = await JSZip.loadAsync(await fs.readFile(source));
const documentEntry = archive.file("word/document.xml");
if (!documentEntry) throw new Error("The reference is not a valid Word document.");
const documentXml = await documentEntry.async("string");
const bodyMatch = documentXml.match(/^([\s\S]*?<w:body\b[^>]*>)([\s\S]*)(<\/w:body>[\s\S]*)$/);
if (!bodyMatch) throw new Error("The Word document body could not be located.");

let paragraphIndex = 0;
let tableIndex = 0;
const transformed = [];
let cursor = 0;
for (const match of bodyMatch[2].matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)) {
  transformed.push(bodyMatch[2].slice(cursor, match.index));
  cursor = match.index + match[0].length;
  if (match[1] === "p") {
    paragraphIndex += 1;
    if (removeParagraph(paragraphIndex)) continue;
    transformed.push(paragraphReplacements.has(paragraphIndex)
      ? replaceBlockText(match[0], paragraphReplacements.get(paragraphIndex))
      : match[0]);
  } else {
    tableIndex += 1;
    transformed.push(transformTable(match[0], tableIndex));
  }
}
transformed.push(bodyMatch[2].slice(cursor));
archive.file("word/document.xml", `${bodyMatch[1]}${transformed.join("")}${bodyMatch[3]}`);

for (const name of ["word/footer1.xml", "word/footer2.xml"]) {
  const entry = archive.file(name);
  if (!entry) continue;
  let xml = await entry.async("string");
  xml = xml.replace(/<w:sdt>[\s\S]*?<w:alias w:val="Publish Date"\/>[\s\S]*?<\/w:sdt>/, "<w:r><w:t>{{issue_date}}</w:t></w:r>");
  xml = xml.replace(/2023/g, "{{issue_year}}");
  archive.file(name, xml);
}

const coreEntry = archive.file("docProps/core.xml");
if (coreEntry) {
  let core = await coreEntry.async("string");
  core = core
    .replace(/<dc:title>[\s\S]*?<\/dc:title>/, "<dc:title>ULA Master Claim Report</dc:title>")
    .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, "<dc:creator>United Loss Adjusters &amp; Surveyors</dc:creator>")
    .replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy>ULA Report Generator</cp:lastModifiedBy>");
  archive.file("docProps/core.xml", core);
}
const appEntry = archive.file("docProps/app.xml");
if (appEntry) {
  let app = await appEntry.async("string");
  app = app.replace(/(<TitlesOfParts>[\s\S]*?<vt:lpstr>)[\s\S]*?(<\/vt:lpstr>[\s\S]*?<\/TitlesOfParts>)/, "$1ULA Master Claim Report$2");
  archive.file("docProps/app.xml", app);
}

const documentRelsName = "word/_rels/document.xml.rels";
let relationships = await archive.file(documentRelsName).async("string");
for (const id of ["rId20", "rId21", "rId22", "rId23"]) {
  relationships = relationships.replace(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*/>`, "g"), "");
}
archive.file(documentRelsName, relationships);
for (const media of ["word/media/image4.png", "word/media/image5.jpeg", "word/media/image6.jpeg", "word/media/image7.jpeg"]) archive.remove(media);

const settingsEntry = archive.file("word/settings.xml");
if (settingsEntry) {
  let settings = await settingsEntry.async("string");
  if (!/<w:updateFields\b/.test(settings)) settings = settings.replace(/<\/w:settings>/, '<w:updateFields w:val="true"/></w:settings>');
  archive.file("word/settings.xml", settings);
}

await fs.mkdir(path.dirname(destination), { recursive: true });
const output = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await fs.writeFile(destination, output);
console.log(`Built sanitized ULA master template: ${destination} (${output.length} bytes)`);
console.log(`Paragraph markers: ${paragraphReplacements.size}; tables preserved: ${tableIndex}; historical appendix media removed: 4`);
