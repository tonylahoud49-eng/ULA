import { evidenceText } from "../evidence/extractEvidence.mjs";

const DOMAIN_SIGNALS = [
  {
    domain: "policy_application",
    label: "operative policy, warranty, exclusion, limit, valuation, or deductible",
    pattern: /\b(policy|cover\s*note|deductible|warrant(?:y|ed)|exclud(?:e|ed|ing|sion)|insured\s+value|valuation|sum\s+insured|clause|endorsement)\b/i,
  },
  {
    domain: "chronology_custody",
    label: "chronology, transport, delivery, custody, attendance, or handling evidence",
    pattern: /\b(bill\s+of\s+lading|waybill|awb|cmr|container|vessel|voyage|shipment|transit|delivery|discharge|gate.?out|custody|carrier|forwarder|incident|discovery|notification|attendance|site\s+visit|fire\s+brigade|civil\s+defen[cs]e|rainfall)\b/i,
  },
  {
    domain: "condition_extent",
    label: "survey, damage, inspection, condition, or photographic evidence",
    pattern: /\b(survey|inspect(?:ion|ed)?|damage|damaged|condition|photograph|photo|broken|crack(?:ed)?|wet(?:ting)?|shortage|missing|affected|seepage|smoke|soot|burnt|melted)\b/i,
  },
  {
    domain: "proximate_cause",
    label: "loss mechanism, incident, or causal-indicator evidence",
    pattern: /\b(cause|impact|handling|compression|collapse|water|fire|temperature|delay|theft|tamper|seal|accident|rough|leak(?:age)?|seepage|rain(?:fall)?|over.?voltage|surge|electrical|ignition)\b/i,
  },
  {
    domain: "quantum_mitigation",
    label: "invoice, quotation, claim, quantity, rate, salvage, or mitigation evidence",
    pattern: /\b(invoice|quotation|quote|estimate|claim(?:ed)?|amount|currency|eur|usd|lbp|quantity|unit\s+price|rate|repair|salvage|mitigat(?:e|ion)|receipt|depreciation|vat|remediation|disposal)\b/i,
  },
  {
    domain: "liability_recovery",
    label: "notice, contractual, carrier, recovery, or liability evidence",
    pattern: /\b(notice|reservation|liab(?:le|ility)|recover(?:y|able)|subrogation|contract|claim\s+against|time\s+bar|limitation)\b/i,
  },
];

const pageRange = (pages = []) => {
  const numbered = pages.map((page) => page.page).filter(Number.isInteger).sort((a, b) => a - b);
  if (!numbered.length) return "non-paginated content";
  return numbered.length === 1 ? `page ${numbered[0]}` : `pages ${numbered[0]}–${numbered.at(-1)}`;
};

/**
 * Builds a claim-specific checklist from current evidence. It is a reasoning
 * aid only: it neither supplies facts nor permits an inference without a
 * source. The same plan is used to flag an incomplete provider response.
 */
export function buildAnalysisCoveragePlan(evidence = []) {
  const corpus = evidence.map((item) => evidenceText(item)).join("\n");
  const requiredDomains = DOMAIN_SIGNALS.filter(({ pattern }) => pattern.test(corpus));
  const inventory = evidence.map((item) => `${item.document_name}: ${pageRange(item.pages)}${item.native_pdf ? " (native PDF also supplied for visual review)" : ""}`).join("; ");
  return {
    requiredDomains,
    prompt: [
      `CURRENT-CLAIM PAGE INVENTORY: ${inventory || "No paginated evidence."}`,
      `CLAIM-SPECIFIC COMPLETENESS PLAN: ${requiredDomains.length
        ? requiredDomains.map((item) => `${item.domain} (${item.label})`).join("; ")
        : "Use the full Director issue ledger and retain every material issue."}`,
      "Internally account for every listed PDF page before writing. For every listed applicable domain, return at least one cited, domain-labelled finding when the evidence contains a material issue; if the evidence is insufficient, state the exact gap and decision it affects instead of silently omitting the domain. Do not create a finding merely to satisfy the checklist.",
    ].join("\n"),
  };
}

export function enforceAnalysisCoverage(analysis, evidence = []) {
  const plan = buildAnalysisCoveragePlan(evidence);
  const returned = new Set((analysis.evidence_findings || []).map((finding) => finding.analysis_domain));
  const warnings = [...(analysis.warnings || [])];
  const humanReview = [...(analysis.human_review_required || [])];
  for (const requirement of plan.requiredDomains) {
    if (returned.has(requirement.domain)) continue;
    const note = `Analysis completeness review: current evidence contains ${requirement.label}, but no cited ${requirement.domain} finding was returned; confirm that issue before report issue.`;
    warnings.push(note);
    humanReview.push(note);
  }
  return {
    ...analysis,
    warnings: [...new Set(warnings)],
    human_review_required: [...new Set(humanReview)],
  };
}
