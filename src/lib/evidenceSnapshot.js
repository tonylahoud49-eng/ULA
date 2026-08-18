const TEXT_EXTENSIONS = new Set([".txt", ".csv", ".json", ".xml", ".html", ".htm", ".md", ".rtf"]);

const extensionOf = (name) => {
  const match = String(name || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "";
};

const normalizeText = (value) => String(value || "")
  .replaceAll("\u0000", "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const pdfPageText = (items = []) => {
  const populated = items.filter((item) => String(item.str || "").trim());
  const rawText = normalizeText(populated.map((item) => item.str).join(" "));
  const lines = [];

  for (const item of populated) {
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push({ x, text: String(item.str).trim() });
  }

  const layoutText = normalizeText(lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.items
      .sort((left, right) => left.x - right.x)
      .map((item) => item.text)
      .join(" "))
    .join("\n"));

  return {
    text: layoutText || rawText,
    raw_text: rawText && rawText !== layoutText ? rawText : undefined,
    extraction_status: layoutText || rawText ? "extracted" : "image-only",
  };
};

const xmlText = (xml) => normalizeText(
  String(xml || "")
    .replace(/<w:tab\s*\/?>/gi, "\t")
    .replace(/<w:br\s*\/?>/gi, "\n")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'"),
);

async function extractPdfPages(blob) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), disableWorker: true });
  const pdf = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push({ page: pageNumber, ...pdfPageText(content.items) });
  }
  return pages;
}

async function extractDocxPages(blob) {
  const { default: JSZip } = await import("jszip");
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentXml = archive.file("word/document.xml");
  if (!documentXml) throw new Error("The DOCX package does not contain word/document.xml.");
  return [{ page: null, text: xmlText(await documentXml.async("string")) }];
}

export async function createEvidenceSnapshots(documents, getStoredDocument) {
  return Promise.all(documents.map(async (document) => {
    const base = {
      document_id: document.id,
      document_name: document.file_name || "Uploaded document",
      mime_type: document.file_mime_type || "application/octet-stream",
      detected_categories: document.detected_categories || [],
      pages: [],
      extraction_status: "unavailable",
    };

    try {
      const stored = await getStoredDocument(document.storage_key || document.file_url);
      const blob = stored.blob;
      const extension = extensionOf(document.file_name || stored.name);
      const mimeType = String(document.file_mime_type || stored.mimeType || blob.type || "").toLowerCase();
      let pages = [];

      if (mimeType === "application/pdf" || extension === ".pdf") {
        pages = await extractPdfPages(blob);
      } else if (mimeType.includes("wordprocessingml") || extension === ".docx") {
        pages = await extractDocxPages(blob);
      } else if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extension)) {
        pages = [{ page: null, text: normalizeText(await blob.text()) }];
      } else if (mimeType.startsWith("image/")) {
        return { ...base, extraction_status: "vision-only" };
      } else {
        return { ...base, extraction_status: "unsupported" };
      }

      const searchablePageCount = pages.filter((page) => page.text).length;
      return {
        ...base,
        pages,
        searchable_page_count: searchablePageCount,
        image_only_page_count: pages.length - searchablePageCount,
        extraction_status: searchablePageCount ? "extracted" : "vision-only",
      };
    } catch (error) {
      return { ...base, extraction_status: "failed", warning: error.message };
    }
  }));
}
