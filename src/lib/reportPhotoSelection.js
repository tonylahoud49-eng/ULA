export const MIN_REPORT_PHOTOGRAPHS = 3;
export const REPORT_PHOTOGRAPHS_PER_PAGE = 4;
export const MAX_REPORT_PHOTO_PAGES = 3;
export const MAX_REPORT_PHOTOGRAPHS = REPORT_PHOTOGRAPHS_PER_PAGE * MAX_REPORT_PHOTO_PAGES;

const byteFingerprint = (data) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (!bytes.length) return "empty";
  const samples = [];
  const sampleCount = Math.min(96, bytes.length);
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(bytes[Math.floor(index * (bytes.length - 1) / Math.max(1, sampleCount - 1))]);
  }
  return `${bytes.length}:${samples.join(".")}`;
};

const metadataKey = (item) => `${item.document_id || item.document_name || ""}:${item.page ?? "image"}:${item.contact_sheet_index ?? "full"}`;

export function selectReportPhotographs(images = [], preferred = [], maximum = MAX_REPORT_PHOTOGRAPHS) {
  const preferredByKey = new Map(preferred.map((item, index) => [metadataKey(item), { ...item, rank: index }]));
  const ranked = images.map((image, index) => {
    const exact = preferredByKey.get(metadataKey(image));
    const documentFallback = preferred.find((item) => item.document_id === image.document_id && item.page === null);
    return {
      ...image,
      caption: exact?.caption || documentFallback?.caption || image.caption || "Overview of the claim-related visual condition available for professional review.",
      rank: exact?.rank ?? (documentFallback ? preferred.indexOf(documentFallback) + 100 : 1_000 + index),
    };
  }).sort((left, right) => left.rank - right.rank);

  const selected = [];
  const metadata = new Set();
  const fingerprints = new Set();
  for (const image of ranked) {
    const key = metadataKey(image);
    const fingerprint = byteFingerprint(image.data);
    if (metadata.has(key) || fingerprints.has(fingerprint)) continue;
    metadata.add(key);
    fingerprints.add(fingerprint);
    selected.push(image);
    if (selected.length >= maximum) break;
  }
  return selected;
}
