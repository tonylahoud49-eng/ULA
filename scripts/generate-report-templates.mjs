import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  FALLBACK_REPORT_TEMPLATE,
  REPORT_TEMPLATES,
  REPORT_WORKFLOW_ROLES,
} from "../src/lib/reportTemplates.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const outputDir = path.join(projectRoot, "samples", "templates");
const logo = await fs.readFile(path.join(outputDir, "assets", "ula-logo.png"));
const sourceSample = await fs.readFile(path.join(projectRoot, "samples", "Property Sample.docx"));
const sourceSampleZip = await JSZip.loadAsync(sourceSample);
const justiceArtwork = await sourceSampleZip.file("word/media/image12.png")?.async("nodebuffer");

if (!justiceArtwork) {
  throw new Error("The ULA justice artwork could not be read from the approved Property sample.");
}

const colors = {
  teal: "1F8A79",
  ink: "17211F",
  paper: "F3F5F2",
  line: "B9C2BE",
  muted: "5E6A66",
  white: "FFFFFF",
};

const border = { style: BorderStyle.SINGLE, size: 4, color: colors.line };
const borders = { top: border, bottom: border, left: border, right: border };

const text = (value, options = {}) => new TextRun({ text: value, font: "Aptos", color: colors.ink, ...options });

const labelCell = (label) => new TableCell({
  width: { size: 28, type: WidthType.PERCENTAGE },
  shading: { fill: colors.paper },
  borders,
  margins: { top: 100, right: 120, bottom: 100, left: 120 },
  children: [new Paragraph({ children: [text(label, { bold: true, size: 18 })] })],
});

const valueCell = (value) => new TableCell({
  width: { size: 72, type: WidthType.PERCENTAGE },
  borders,
  margins: { top: 100, right: 120, bottom: 100, left: 120 },
  children: [new Paragraph({ children: [text(value, { size: 19 })] })],
});

const fieldTable = (rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: rows.map(([label, value]) => new TableRow({ children: [labelCell(label), valueCell(value)] })),
});

const controlRoleCell = (role) => new TableCell({
  width: { size: 25, type: WidthType.PERCENTAGE },
  borders,
  margins: { top: 110, right: 90, bottom: 110, left: 90 },
  children: [
    new Paragraph({ children: [text(role.label, { bold: true, size: 17, color: colors.teal })] }),
    new Paragraph({ children: [text(`{{${role.id}_name}}`, { bold: true, size: 19 })] }),
    new Paragraph({ children: [text(`{{${role.id}_designation}}`, { size: 16, color: colors.muted })] }),
    new Paragraph({ children: [text(`Signature: {{${role.id}_signature}}`, { size: 15 })] }),
    new Paragraph({ children: [text(`Date: {{${role.id}_date}}`, { size: 15 })] }),
  ],
});

const sectionPlaceholder = (section) => [
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 140 },
    children: [text(section.title, { bold: true, size: 28, color: colors.teal })],
  }),
  new Paragraph({
    spacing: { after: 160 },
    children: [text(`{{${section.id}}}`, { size: 20 })],
  }),
  ...(section.humanApproval
    ? [new Paragraph({
      shading: { fill: "FFF4D9" },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: "C8872F" } },
      indent: { left: 180 },
      spacing: { before: 80, after: 120 },
      children: [text("Professional review required before issue.", { bold: true, size: 16, color: "8B5A16" })],
    })]
    : []),
];

const controlledCover = (template) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 220 },
    children: [new ImageRun({ data: logo, transformation: { width: 148, height: 148 }, type: "png" })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [text("UNITED LOSS ADJUSTERS & SURVEYORS", { bold: true, size: 17, color: colors.teal })],
  }),
  new Paragraph({
    style: "Title",
    alignment: AlignmentType.CENTER,
    spacing: { before: 420, after: 130 },
    children: [text(template.name, { bold: true, size: 48 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [text("{{report_issue_state}} REPORT", { bold: true, size: 22, color: colors.teal })],
  }),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [labelCell("INSURED"), valueCell("{{insured_name}}") ] }),
      new TableRow({ children: [labelCell("INSURER"), valueCell("{{insurer}}") ] }),
      new TableRow({ children: [labelCell("ULA REFERENCE"), valueCell("{{claim_number}}") ] }),
    ],
  }),
  new Paragraph({ spacing: { before: 260 }, children: [new PageBreak()] }),
];

const finalCorporatePage = () => [
  new Paragraph({ children: [new PageBreak()] }),
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [new TableCell({
      shading: { fill: colors.teal },
      borders: { top: { style: BorderStyle.SINGLE, size: 10, color: colors.teal }, bottom: { style: BorderStyle.SINGLE, size: 10, color: colors.teal }, left: { style: BorderStyle.SINGLE, size: 10, color: colors.teal }, right: { style: BorderStyle.SINGLE, size: 10, color: colors.teal } },
      margins: { top: 420, right: 420, bottom: 420, left: 420 },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: justiceArtwork, transformation: { width: 270, height: 270 }, type: "png" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 180, after: 90 }, children: [new ImageRun({ data: logo, transformation: { width: 86, height: 86 }, type: "png" })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [text("UNITED LOSS ADJUSTERS & SURVEYORS", { bold: true, size: 20, color: colors.white })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 130, after: 180 }, children: [text("Independent loss adjusting, surveying and claims consultancy", { size: 16, color: colors.white })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [text("This controlled report is issued subject to ULA's agreed terms, conditions and professional review requirements.", { size: 15, color: colors.white })] }),
      ],
    })] })],
  }),
];

function buildDocument(template) {
  const allSections = template.sections.filter((section, index, items) =>
    items.findIndex((candidate) => candidate.id === section.id) === index,
  );

  return new Document({
    creator: "United Loss Adjusters & Surveyors",
    title: `ULA ${template.name}`,
    description: "Sanitized unified ULA claim report template",
    styles: {
      default: { document: { run: { font: "Aptos", size: 20, color: colors.ink } } },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { font: "Aptos Display", size: 46, bold: true, color: colors.ink },
          paragraph: { spacing: { before: 200, after: 160 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos Display", size: 28, bold: true, color: colors.teal },
          paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: colors.line } },
            alignment: AlignmentType.CENTER,
            children: [
              text("ULA · {{legal_entity}} · {{form_code}} · Version {{version_number}} · Page ", { size: 15, color: colors.muted }),
              new TextRun({ children: [PageNumber.CURRENT], size: 15, color: colors.muted }),
              text(" of ", { size: 15, color: colors.muted }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: colors.muted }),
            ],
          })],
        }),
      },
      children: [
        ...controlledCover(template),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("Document Control", { bold: true, size: 28, color: colors.teal })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ children: REPORT_WORKFLOW_ROLES.map(controlRoleCell) })],
        }),
        new Paragraph({ spacing: { before: 180, after: 120 }, children: [text("This report is issued without prejudice to the rights and defences of all parties concerned.", { italics: true, size: 17, color: colors.muted })] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("Version History", { bold: true, size: 28, color: colors.teal })] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ["Version", "Date of issue", "Issue state", "Reason for revision"].map((heading) => new TableCell({ shading: { fill: colors.teal }, borders, children: [new Paragraph({ children: [text(heading, { bold: true, size: 17, color: colors.white })] })] })) }),
            new TableRow({ children: ["{{version_number}}", "{{issue_date}}", "{{report_issue_state}}", "{{revision_reason}}"].map((value) => new TableCell({ borders, children: [new Paragraph({ children: [text(value, { size: 17 })] })] })) }),
          ],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("Claim Salient Details", { bold: true, size: 28, color: colors.teal })] }),
        fieldTable([
          ["Insurer", "{{insurer}}"],
          ["Insured", "{{insured_name}}"],
          ["Broker / Agent", "{{broker}}"],
          ["Business Line", "{{business_line}}"],
          ["Claimed Amount", "{{currency}} {{claimed_amount}}"],
          ["Adjusted Amount", "{{currency}} {{adjusted_amount}}"],
        ]),
        ...allSections.flatMap(sectionPlaceholder),
        ...finalCorporatePage(),
      ],
    }],
  });
}

const documents = [
  ["ULA-Master-Report.docx", FALLBACK_REPORT_TEMPLATE],
  ...Object.values(REPORT_TEMPLATES).map((template) => [`ULA-${template.id}-Report.docx`, template]),
];

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "assets", "ula-justice.png"), justiceArtwork);
for (const [filename, template] of documents) {
  const buffer = await Packer.toBuffer(buildDocument(template));
  await fs.writeFile(path.join(outputDir, filename), buffer);
  process.stdout.write(`Generated ${filename}\n`);
}
