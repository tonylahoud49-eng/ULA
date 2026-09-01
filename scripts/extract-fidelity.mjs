import fs from "node:fs/promises";
import JSZip from "jszip";

async function extractFidelity() {
  const data = await fs.readFile("samples/Fidelity Sample.docx");
  const zip = await JSZip.loadAsync(data);
  console.log("=== Media files in Fidelity Sample.docx ===");
  for (const [name, file] of Object.entries(zip.files)) {
    if (name.startsWith("word/media/")) {
      const buffer = await file.async("nodebuffer");
      console.log("File:", name, "Size:", buffer.length, "bytes");
      const outPath = "samples/fidelity_" + name.replace("word/media/", "");
      await fs.writeFile(outPath, buffer);
    }
  }

  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
  console.log("\nRels:\n", relsXml);

  const docXml = await zip.file("word/document.xml")?.async("string");
  if (docXml) {
    const drawings = [...docXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
    drawings.forEach((m, i) => {
      const cx = parseInt(m[1], 10);
      const cy = parseInt(m[2], 10);
      console.log(`Drawing ${i+1}: cx=${cx}, cy=${cy} (${(cx/9525).toFixed(1)}px x ${(cy/9525).toFixed(1)}px)`);
    });
  }
}

await extractFidelity();
