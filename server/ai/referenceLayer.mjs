import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceText } from "../evidence/extractEvidence.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEGAL_INDEX = path.resolve(moduleDirectory, "../../.data/legal-references/index.json");
const DEFAULT_MAX_REFERENCES = 6;
const DEFAULT_MAX_EXCERPT_CHARACTERS = 1_400;
const legalIndexCache = new Map();

const TOPIC_EXPANSIONS = [
  {
    pattern: /bill of lading|charterparty|charter party|shipowner|sea carriage|ocean carrier|vessel shipment|maritime carriage/i,
    terms: ["bill", "lading", "carrier", "charterparty", "delivery", "shortage", "shipper", "consignee"],
  },
  {
    pattern: /fair presentation|disclosure|misrepresentation|material circumstance/i,
    terms: ["presentation", "disclosure", "misrepresentation", "material", "circumstance", "assured"],
  },
  {
    pattern: /warranty|condition precedent/i,
    terms: ["warranty", "condition", "precedent", "breach"],
  },
  {
    pattern: /exclusion|coverage|policy term/i,
    terms: ["exclusion", "coverage"],
  },
  {
    pattern: /proximate cause|cause of loss|causation|peril|concurrent cause/i,
    terms: ["proximate", "cause", "causation", "peril", "concurrent"],
  },
  {
    pattern: /salvage|subrogation|recovery|contribution|third party/i,
    terms: ["salvage", "subrogation", "recovery", "contribution", "thirdparty"],
  },
  {
    pattern: /general average|particular average|average adjustment|average adjuster/i,
    terms: ["generalaverage", "particularaverage", "adjustment", "adjuster", "contribution"],
  },
  {
    pattern: /seaworth|deviation|voyage|vessel/i,
    terms: ["seaworthiness", "deviation", "voyage", "vessel"],
  },
  {
    pattern: /marine insurance|marine cargo|cargo (?:insurance )?policy/i,
    terms: ["marine", "cargo", "transit"],
  },
  {
    pattern: /collision|allision|grounding|stranding|maritime casualty/i,
    terms: ["collision", "allision", "grounding", "stranding", "casualty", "liability"],
  },
  {
    pattern: /pollution|environmental damage|oil spill/i,
    terms: ["pollution", "environmental", "spill", "liability", "mitigation"],
  },
  {
    pattern: /time bar|limitation period|jurisdiction|governing law/i,
    terms: ["timebar", "limitation", "jurisdiction", "governinglaw", "notice"],
  },
];

const LEGAL_QUERY_TERMS = new Set([
  "adjuster", "adjustment", "assured", "breach", "cargo", "causation", "concurrent", "condition", "contribution",
  "coverage", "deviation", "disclosure", "exclusion", "fraud", "generalaverage", "indemnity", "insured", "lading",
  "marine", "material", "misrepresentation", "particularaverage", "peril", "precedent", "presentation", "proximate",
  "recovery", "remedies", "remedy", "salvage", "seaworthiness", "subrogation", "transit", "vessel", "voyage", "warranty",
  "allision", "casualty", "collision", "environmental", "grounding", "jurisdiction", "limitation", "mitigation", "pollution", "stranding",
]);

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/\p{M}/gu, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const queryTerms = (value) => {
  const normalized = normalizeSearchText(value);
  const terms = new Set(normalized.split(" ").filter((term) => LEGAL_QUERY_TERMS.has(term)));
  for (const topic of TOPIC_EXPANSIONS) {
    if (topic.pattern.test(value)) topic.terms.forEach((term) => terms.add(normalizeSearchText(term)));
  }
  return { normalized, terms: [...terms] };
};

const occurrences = (text, term) => {
  let count = 0;
  let position = text.indexOf(term);
  while (position >= 0 && count < 3) {
    count += 1;
    position = text.indexOf(term, position + term.length);
  }
  return count;
};

const authorityWeight = (title) => /insurance act|marine insurance act/i.test(title)
  ? 2.5
  : /association of average adjusters/i.test(title) ? 1.8 : /gard guidance/i.test(title) ? 1.1 : 0.85;

const sourceAppliesToQuery = (title, query) => {
  if (/association of average adjusters/i.test(title)) {
    return /general average|particular average|average adjustment|average adjuster|sacrifice|contribution/i.test(query);
  }
  if (/scrutton/i.test(title)) {
    return /bill of lading|charterparty|charter party|shipowner|sea carriage|ocean carrier|vessel shipment|maritime carriage/i.test(query);
  }
  if (/insurance act 2015/i.test(title)) {
    return /fair presentation|disclosure|misrepresentation|warranty|fraud|remed(?:y|ies)|contracting out/i.test(query);
  }
  if (/gard guidance on maritime claims/i.test(title)) {
    const airCarriageOnly = /air shipment|air waybill|air carrier/i.test(query)
      && !/bill of lading|charterparty|charter party|shipowner|sea carriage|ocean carrier|vessel shipment|maritime carriage/i.test(query);
    if (airCarriageOnly) return false;
    return /marine cargo|marine insurance|bill of lading|charterparty|charter party|shipowner|sea carriage|ocean carrier|vessel|maritime|collision|allision|grounding|stranding|pollution|oil spill|p&i|general average|salvage/i.test(query);
  }
  if (/marine insurance clauses|marine insurance act/i.test(title)) {
    const airCarriageOnly = /air shipment|air waybill|air carrier/i.test(query)
      && !/bill of lading|charterparty|charter party|shipowner|sea carriage|ocean carrier|vessel shipment|maritime carriage/i.test(query);
    if (airCarriageOnly) return false;
    return /marine insurance|marine cargo|cargo (?:insurance )?policy|insured|assured|coverage|exclusion|proximate cause|peril|warranty|salvage|subrogation|total loss|partial loss|general average/i.test(query);
  }
  return true;
};

const excerptAroundTerms = (text, terms, maximum) => {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (source.length <= maximum) return source;
  const searchable = source.toLocaleLowerCase();
  const center = terms.map((term) => searchable.indexOf(term.toLocaleLowerCase())).find((position) => position >= 0) || 0;
  const start = Math.max(0, Math.min(source.length - maximum, center - Math.floor(maximum * 0.25)));
  const raw = source.slice(start, start + maximum);
  const leftBoundary = start ? raw.indexOf(" ") : 0;
  const rightBoundary = start + maximum < source.length ? raw.lastIndexOf(" ") : raw.length;
  return `${start ? "…" : ""}${raw.slice(Math.max(0, leftBoundary), rightBoundary).trim()}${start + maximum < source.length ? "…" : ""}`;
};

export function defaultLegalReferenceIndexPath() {
  return DEFAULT_LEGAL_INDEX;
}

export async function loadApprovedStyleReferences(directory) {
  if (!directory) return [];
  let names;
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }

  const references = [];
  for (const name of names.filter((item) => item.toLowerCase().endsWith(".json"))) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
      if (parsed.approved !== true) continue;
      const appliesTo = parsed.applies_to && typeof parsed.applies_to === "object"
        ? {
            client_terms: Array.isArray(parsed.applies_to.client_terms) ? parsed.applies_to.client_terms.map(String) : [],
            evidence_terms_any: Array.isArray(parsed.applies_to.evidence_terms_any) ? parsed.applies_to.evidence_terms_any.map(String) : [],
            business_lines: Array.isArray(parsed.applies_to.business_lines) ? parsed.applies_to.business_lines.map(String) : [],
          }
        : null;
      references.push({
        profile_id: String(parsed.profile_id || name.replace(/\.json$/i, "")),
        title: String(parsed.title || name),
        section_order: Array.isArray(parsed.section_order) ? parsed.section_order.map(String) : [],
        style_notes: Array.isArray(parsed.style_notes) ? parsed.style_notes.map(String) : [],
        applies_to: appliesTo,
        source_role: "style_reference_only",
      });
    } catch {
      // Invalid or unapproved manifests are intentionally ignored.
    }
  }
  return references;
}

export function selectApplicableStyleReferences(references = [], { claim = {}, evidence = [] } = {}) {
  const claimText = Object.values(claim || {})
    .filter((value) => ["string", "number", "boolean"].includes(typeof value))
    .join(" ");
  const combinedEvidence = evidence.map((item) => evidenceText(item)).join(" ");
  const searchable = normalizeSearchText(`${claimText} ${combinedEvidence}`);
  const searchableEvidence = normalizeSearchText(combinedEvidence);
  const businessLine = String(claim?.business_line || claim?.ai_suggested_business_line || "").trim().toLowerCase();
  const specificBusinessLine = businessLine
    && !["unclassified", "requires review", "other / requires review"].includes(businessLine);
  const containsAny = (terms, source = searchable) => terms.some((term) => {
    const normalized = normalizeSearchText(term);
    return normalized && source.includes(normalized);
  });

  return references.filter((reference) => {
    if (reference?.source_role !== "style_reference_only") return false;
    const scope = reference.applies_to;
    if (!scope) return true;
    if (scope.client_terms?.length && !containsAny(scope.client_terms)) return false;
    if (scope.evidence_terms_any?.length && !containsAny(scope.evidence_terms_any, searchableEvidence)) return false;
    if (scope.business_lines?.length && specificBusinessLine
      && !scope.business_lines.some((line) => String(line).trim().toLowerCase() === businessLine)) return false;
    return true;
  });
}

export async function selectLegalReferences({
  claim = {},
  evidence = [],
  indexPath = DEFAULT_LEGAL_INDEX,
  maxReferences = DEFAULT_MAX_REFERENCES,
  maxExcerptCharacters = DEFAULT_MAX_EXCERPT_CHARACTERS,
} = {}) {
  let index;
  const cached = legalIndexCache.get(indexPath);
  if (cached) {
    index = cached;
  } else {
    try {
      const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
      index = {
        ...parsed,
        chunks: Array.isArray(parsed.chunks)
          ? parsed.chunks.map((chunk) => ({ ...chunk, searchable_text: normalizeSearchText(chunk.text) }))
          : parsed.chunks,
      };
      legalIndexCache.set(indexPath, index);
    } catch {
      return [];
    }
  }
  if (index?.version !== 1 || !Array.isArray(index.chunks)) return [];

  const query = [
    Object.entries(claim).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => `${key} ${value}`).join(" "),
    evidence.map((item) => evidenceText(item)).join(" "),
  ].join(" ");
  const { terms } = queryTerms(query);
  if (!terms.length) return [];

  const documentFrequency = new Map(terms.map((term) => [
    term,
    index.chunks.reduce((count, chunk) => count + (chunk.searchable_text?.includes(term) ? 1 : 0), 0),
  ]));
  const scored = index.chunks.flatMap((chunk) => {
    if (!chunk?.text || !chunk?.title || !Number.isInteger(chunk.page)) return [];
    if (!sourceAppliesToQuery(chunk.title, query)) return [];
    const searchable = chunk.searchable_text;
    const matchedTerms = terms.filter((term) => searchable.includes(term)).sort((left, right) => {
      const phraseDifference = Number(right.includes(" ")) - Number(left.includes(" "));
      if (phraseDifference) return phraseDifference;
      return (documentFrequency.get(left) || 0) - (documentFrequency.get(right) || 0);
    });
    if (!matchedTerms.length) return [];
    const termScore = matchedTerms.reduce((total, term) => {
      const frequency = documentFrequency.get(term) || 0;
      const inverseDocumentFrequency = Math.log((index.chunks.length + 1) / (frequency + 1)) + 1;
      return total + (Math.min(occurrences(searchable, term), 3) * inverseDocumentFrequency);
    }, 0);
    const phraseScore = TOPIC_EXPANSIONS.reduce((total, topic) => {
      if (!topic.pattern.test(query)) return total;
      const topicMatches = topic.terms.map(normalizeSearchText).filter((term) => searchable.includes(term));
      const multiwordMatches = topicMatches.filter((term) => term.includes(" ")).length;
      return total + (topicMatches.length >= 2 ? topicMatches.length * 1.5 : 0) + (multiwordMatches * 4);
    }, 0);
    const titleScore = terms.filter((term) => normalizeSearchText(chunk.title).includes(term)).length * 0.5;
    const score = (termScore + phraseScore + titleScore) * authorityWeight(chunk.title);
    if (score < 5) return [];
    return [{ chunk, matchedTerms, score }];
  }).sort((left, right) => right.score - left.score || left.chunk.title.localeCompare(right.chunk.title) || left.chunk.page - right.chunk.page);

  const selected = [];
  const perSource = new Map();
  const seenExcerpts = new Set();
  for (const candidate of scored) {
    if (selected.length >= Math.max(0, maxReferences)) break;
    const sourceCount = perSource.get(candidate.chunk.source_id) || 0;
    const perSourceLimit = /insurance act|association of average adjusters/i.test(candidate.chunk.title) ? 2 : 1;
    if (sourceCount >= perSourceLimit) continue;
    const excerpt = excerptAroundTerms(candidate.chunk.text, candidate.matchedTerms, maxExcerptCharacters);
    const fingerprint = normalizeSearchText(excerpt);
    if (!fingerprint || seenExcerpts.has(fingerprint)) continue;
    seenExcerpts.add(fingerprint);
    perSource.set(candidate.chunk.source_id, sourceCount + 1);
    selected.push({
      reference_id: `${candidate.chunk.source_id}:p${candidate.chunk.page}${candidate.chunk.chunk_index ? `:c${candidate.chunk.chunk_index}` : ""}`,
      title: candidate.chunk.title,
      page: candidate.chunk.page,
      excerpt,
      matched_topics: candidate.matchedTerms.slice(0, 8),
      source_role: "legal_reference_only",
    });
  }
  return selected;
}

export function splitAnalysisReferences(references = []) {
  return {
    styleReferences: references.filter((item) => item?.source_role === "style_reference_only"),
    legalReferences: references.filter((item) => item?.source_role === "legal_reference_only"),
  };
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const excerptNgrams = (references) => references.flatMap((reference) => {
  const words = normalizeSearchText(reference?.excerpt).split(" ").filter(Boolean);
  if (words.length < 12) return [];
  const ngrams = [];
  for (let index = 0; index <= words.length - 12; index += 8) ngrams.push(words.slice(index, index + 12).join(" "));
  return ngrams;
});

export function sanitizeReferenceNarrative(analysis, references = []) {
  if (!analysis || !references.length) return analysis;
  const titles = uniqueReferenceValues(references.map((item) => item?.title));
  const referenceIds = uniqueReferenceValues(references.map((item) => item?.reference_id));
  const quotedNgrams = excerptNgrams(references);
  const sanitize = (value) => {
    let text = String(value || "").trim();
    if (!text) return "";
    for (const title of titles) text = text.replace(new RegExp(escapeRegExp(title), "gi"), "applicable professional principles");
    for (const referenceId of referenceIds) text = text.replace(new RegExp(escapeRegExp(referenceId), "gi"), "");
    text = text.replace(/(?:(?:according to|under|as (?:set out|explained) in|see)\s+)?applicable professional principles\s*(?:(?:states?|provides?|explains?|indicates?|suggests?)\s+that)?\s*[:,;-]?\s*/gi, "");
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => {
      const normalized = normalizeSearchText(sentence);
      return !quotedNgrams.some((ngram) => normalized.includes(ngram));
    });
    return sentences.join(" ").replace(/\s+/g, " ").trim();
  };
  const findings = (analysis.evidence_findings || []).flatMap((item) => {
    const finding = sanitize(item.finding);
    return finding ? [{ ...item, finding }] : [];
  });
  return {
    ...analysis,
    classification: analysis.classification ? { ...analysis.classification, rationale: sanitize(analysis.classification.rationale) } : analysis.classification,
    document_types: (analysis.document_types || []).map((item) => ({ ...item, rationale: sanitize(item.rationale) })),
    evidence_findings: findings,
    summary: sanitize(analysis.summary) || "Professional assessment is set out in the grounded claim findings.",
    warnings: (analysis.warnings || []).map(sanitize).filter(Boolean),
    human_review_required: (analysis.human_review_required || []).map(sanitize).filter(Boolean),
  };
}

function uniqueReferenceValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
