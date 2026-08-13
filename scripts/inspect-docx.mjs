import fs from "node:fs/promises";
import JSZip from "jszip";

async function inspectDocx(filePath) {
  console.log("=== Inspecting:", filePath);
  const data = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(data);
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.startsWith("word/media/")) {
      const buffer = await file.async("nodebuffer");
      console.log("Media file:", name, "Size:", buffer.length, "bytes");
      // Let's save each media file with its original size
      const outName = name.replace("word/media/", "extracted_");
      await fs.writeFile(`samples/${outName}`, buffer);
    }
  }
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  console.log("\nDocument Rels:\n", relsXml);

  const docXml = await zip.file("word/document.xml")?.async("string");
  if (docXml) {
    console.log("\nHas document.xml, length:", docXml.length);
    // Find all drawing extents
    const extents = [...docXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
    extents.forEach((m, i) => {
      const cx = parseInt(m[1], 10);
      const cy = parseInt(m[2], 10);
      // In OpenXML drawing, 1 inch = 914400 EMUs, 1 pt = 12700 EMUs, 1 px at 96 DPI = 9525 EMUs
      const widthPt = cx / 12700;
      const heightPt = cy / 12700;
      const widthPx = cx / 9525;
      const heightPx = cy / 9525;
      console.log(`Drawing ${i+1}: cx=${cx}, cy=${cy} -> ${widthPt.toFixed(1)}pt x ${heightPt.toFixed(1)}pt (${widthPx.toFixed(1)}px x ${heightPx.toFixed(1)}px)`);
    });
  }
}

await inspectDocx("samples/Air Shipment Sample.docx");
console.log("\n--- Checking Master Template ---");
await inspectDocx("samples/templates/ULA-Master-Report.docx");
