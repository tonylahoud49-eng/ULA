import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const [source, outputDir] = process.argv.slice(2);
if (!source || !outputDir) throw new Error("Usage: node scripts/render-pdf-preview.mjs <source.pdf> <output-dir>");

const document = await pdfjsLib.getDocument({ data: new Uint8Array(await fs.readFile(source)) }).promise;
await fs.mkdir(outputDir, { recursive: true });

for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 4); pageNumber += 1) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  await fs.writeFile(path.join(outputDir, `page-${pageNumber}.png`), canvas.toBuffer("image/png"));
}

console.log(`Rendered ${Math.min(document.numPages, 4)} of ${document.numPages} pages.`);
