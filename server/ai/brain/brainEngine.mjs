import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createConfiguredProvider } from "../provider.mjs";
import { safeParseJsonWithRepair } from "../jsonRepair.mjs";
import { evidenceText } from "../../evidence/extractEvidence.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const BRAIN_ROOT = path.resolve(moduleDir, "../../../.data/brain");
const PROFILES_DIR = path.join(BRAIN_ROOT, "profiles");
const MANIFEST_PATH = path.join(BRAIN_ROOT, "manifest.json");

/**
 * Ensure required brain storage directories exist.
 */
export async function ensureBrainStorage() {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  try {
    await fs.access(MANIFEST_PATH);
  } catch {
    const initialManifest = {
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_learned_reports: 0,
      learned_reports: [],
      business_lines: {},
    };
    await fs.writeFile(MANIFEST_PATH, JSON.stringify(initialManifest, null, 2), "utf8");
  }
}

/**
 * Read the current brain manifest.
 */
export async function getBrainManifest() {
  await ensureBrainStorage();
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { version: 1, total_learned_reports: 0, learned_reports: [], business_lines: {} };
  }
}

/**
 * Sanitize text to remove claim-specific identifiers so the brain never leaks facts.
 * Adheres strictly to docs/REPORT_SPEC.md rules for style/methodology references.
 */
export function sanitizeBrainKnowledge(data = {}, claim = {}) {
  const claimStringsToScrub = [
    claim?.claim_number,
    claim?.claim_reference,
    claim?.policy_number,
    claim?.insured_name,
    claim?.insured,
    claim?.applicant,
    claim?.insurer,
    claim?.reassured,
    claim?.reinsurer,
    claim?.broker,
    claim?.surveyor,
    claim?.vessel_name,
    claim?.feeder_vessel,
    claim?.voyage_number,
    claim?.feeder_voyage,
    claim?.conveyance_reference,
    claim?.container_number,
    claim?.container_numbers,
    claim?.port_of_loading,
    claim?.port_of_discharge,
    claim?.transshipment_port,
    claim?.shipper,
    claim?.consignee,
    claim?.carrier,
    claim?.bill_of_lading,
    claim?.air_waybill,
    claim?.invoice_number,
    claim?.purchase_order,
    claim?.packing_list_number,
    claim?.claim_amount,
    claim?.gross_claim_amount,
    claim?.adjusted_amount,
  ].filter(Boolean).map(String);

  const scrubString = (str) => {
    let result = String(str || "");
    for (const token of claimStringsToScrub) {
      if (token.length > 2) {
        result = result.replaceAll(token, "[REDACTED_CLAIM_ENTITY]");
      }
    }
    // Scrub specific telephone / email patterns
    result = result.replace(/[\w.-]+@[\w.-]+\.\w+/g, "[EMAIL]");
    result = result.replace(/\b\+?[0-9]{10,14}\b/g, "[PHONE]");
    // Scrub monetary amounts with currency indicators
    result = result.replace(/(?:\$|USD|EUR|GBP|LBP)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/gi, "[REDACTED_AMOUNT]");
    // Scrub specific date formats
    result = result.replace(/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, "[REDACTED_DATE]");
    result = result.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, "[REDACTED_DATE]");
    // Scrub standard ISO container numbers (4 capital letters followed by 7 digits)
    result = result.replace(/\b[A-Z]{4}\d{7}\b/g, "[REDACTED_CONTAINER]");
    return result;
  };

  const sanitizeRecursive = (item) => {
    if (typeof item === "string") return scrubString(item);
    if (Array.isArray(item)) return item.map(sanitizeRecursive);
    if (item && typeof item === "object") {
      const cleaned = {};
      for (const [k, v] of Object.entries(item)) {
        cleaned[k] = sanitizeRecursive(v);
      }
      return cleaned;
    }
    return item;
  };

  return sanitizeRecursive(data);
}

/**
 * Prompt instruction to guide the AI model in extracting loss adjuster wisdom.
 */
const BRAIN_LEARNING_PROMPT = `
You are the Chief Claims Director and Master Loss Adjuster at United Loss Adjusters (ULA).
You are inspecting an approved Official Final Loss Adjuster Report alongside the raw evidence documents for a claim.

Your goal is to extract the LOSS ADJUSTER'S METHODOLOGY, REASONING PATTERNS, QUANTUM ADJUSTMENT RUBRICS, and PHRASING to teach the system's autonomous brain.

CRITICAL DIRECTIVES:
1. Do NOT extract specific factual claim data (e.g. do not record the specific person's name, policy number, vessel name, or invoice amount as facts).
2. Extract the REASONING METHODOLOGY:
   - How did the adjuster analyze the proximate cause from evidence?
   - How were adjustments evaluated (e.g. depreciation rates, deduction grounds, freight treatment, salvage calculation)?
   - How were policy warranties, terms, and exclusions tested against the facts?
   - What professional phraseology and transitional statements did the adjuster employ?
3. Format your response strictly as a JSON object matching this schema:
{
  "business_line": "string",
  "methodology_summary": "string",
  "cause_of_loss_rules": [
    { "rule_type": "opening | mechanism_testing | competing_causes | evidence_limitations", "guidance": "string", "example_phrasing": "string" }
  ],
  "quantum_adjustment_rubrics": [
    { "category": "damage | repair | depreciation | salvage | deductible | fees | freight", "decision_rule": "string", "arithmetic_logic": "string" }
  ],
  "policy_application_principles": [
    { "provision_type": "warranty | condition | exclusion | valuation", "interpretation_standard": "string" }
  ],
  "adjuster_phrasing_and_tone": [
    { "section": "summary | cause | adjustment | conclusion", "pattern": "string" }
  ],
  "distinctive_best_practices": ["string"]
}
`;

/**
 * Ingest an official final report, analyze it against claim evidence, and store knowledge in the Brain.
 */
export async function learnFromOfficialReport({
  claim,
  officialReportText,
  officialReportFileName = "official_report.pdf",
  evidence = [],
  providerName,
  modelName,
}) {
  if (!officialReportText || officialReportText.trim().length < 50) {
    throw new Error("The official report text is too short or empty for brain analysis.");
  }

  await ensureBrainStorage();

  // Determine business line
  const businessLine = claim.business_line || claim.ai_suggested_business_line || "Marine Cargo";
  const safeBusinessLineKey = businessLine.toLowerCase().replace(/[^a-z0-9]+/g, "_");

  // Build evidence summary to provide context to the brain learner
  const evidenceSummary = evidence.map((e) => {
    const text = evidenceText(e);
    return `--- DOCUMENT: ${e.document_name} (${e.category || "Evidence"}) ---\n${text.slice(0, 1500)}`;
  }).join("\n\n");

  const promptContent = `
${BRAIN_LEARNING_PROMPT}

=== CLAIM DETAILS ===
Title: ${claim.title || "Claim"}
Business Line: ${businessLine}

=== OFFICIAL FINAL LOSS ADJUSTER REPORT ===
${officialReportText.slice(0, 35000)}

=== SOURCE CLAIM EVIDENCE FILES (SAMPLE) ===
${evidenceSummary.slice(0, 20000)}

Extract the master loss adjuster methodology, causal logic, quantum rubrics, and phrasing according to the system instructions.
Output ONLY valid JSON.
`;

  // Instantiate provider
  const { provider } = createConfiguredProvider({
    providerName,
    modelName,
  });

  if (!provider) {
    throw new Error("No AI provider is configured to perform brain learning.");
  }

  // Execute extraction
  const res = await provider.analyze({
    claim: { ...claim, title: `Brain Learning: ${claim.title || "Report"}` },
    evidence: [{
      document_id: "official-final-report",
      document_name: officialReportFileName,
      kind: "text",
      pages: [{ page: 1, text: promptContent }],
      mime_type: "text/plain",
      extraction_status: "extracted",
    }],
    files: [],
    styleReferences: [],
  });

  // Extract or parse structured result
  let learnedData = res.analysis || {};
  if (typeof learnedData === "string") {
    learnedData = safeParseJsonWithRepair(learnedData) || {};
  }
  if (typeof learnedData.summary === "string" && !learnedData.methodology_summary) {
    learnedData.methodology_summary = learnedData.summary;
  }

  // Sanitize learned knowledge against claim facts
  const sanitized = sanitizeBrainKnowledge(learnedData, claim);

  // Compute a fingerprint for this report
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${officialReportText.slice(0, 5000)}_${businessLine}`)
    .digest("hex")
    .slice(0, 16);

  // Save/merge into the business line profile
  const profilePath = path.join(PROFILES_DIR, `${safeBusinessLineKey}.json`);
  let existingProfile = {
    business_line: businessLine,
    profile_id: `brain_${safeBusinessLineKey}`,
    version: 1,
    last_updated: new Date().toISOString(),
    ingested_reports_count: 0,
    cause_of_loss_rules: [],
    quantum_adjustment_rubrics: [],
    policy_application_principles: [],
    adjuster_phrasing_and_tone: [],
    distinctive_best_practices: [],
  };

  try {
    const raw = await fs.readFile(profilePath, "utf8");
    existingProfile = JSON.parse(raw);
  } catch {
    // New profile
  }

  // Merge new rules without duplicates
  const mergeArray = (existing = [], incoming = [], keyField = "guidance") => {
    const seen = new Set(existing.map((item) => typeof item === "string" ? item : item[keyField] || JSON.stringify(item)));
    const merged = [...existing];
    for (const item of (incoming || [])) {
      const key = typeof item === "string" ? item : item[keyField] || JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  };

  existingProfile.ingested_reports_count += 1;
  existingProfile.last_updated = new Date().toISOString();
  existingProfile.cause_of_loss_rules = mergeArray(existingProfile.cause_of_loss_rules, sanitized.cause_of_loss_rules, "guidance");
  existingProfile.quantum_adjustment_rubrics = mergeArray(existingProfile.quantum_adjustment_rubrics, sanitized.quantum_adjustment_rubrics, "decision_rule");
  existingProfile.policy_application_principles = mergeArray(existingProfile.policy_application_principles, sanitized.policy_application_principles, "interpretation_standard");
  existingProfile.adjuster_phrasing_and_tone = mergeArray(existingProfile.adjuster_phrasing_and_tone, sanitized.adjuster_phrasing_and_tone, "pattern");
  existingProfile.distinctive_best_practices = mergeArray(existingProfile.distinctive_best_practices, sanitized.distinctive_best_practices);

  await fs.writeFile(profilePath, JSON.stringify(existingProfile, null, 2), "utf8");

  // Update manifest
  const manifest = await getBrainManifest();
  manifest.updated_at = new Date().toISOString();
  manifest.total_learned_reports = (manifest.total_learned_reports || 0) + 1;
  manifest.learned_reports = manifest.learned_reports || [];
  manifest.learned_reports.unshift({
    claim_id: claim.id,
    claim_number: claim.claim_number || "—",
    business_line: businessLine,
    report_file_name: officialReportFileName,
    learned_at: new Date().toISOString(),
    fingerprint,
    provider: res.provider || providerName || "ai",
    model: res.model || modelName || "model",
  });
  manifest.business_lines[businessLine] = (manifest.business_lines[businessLine] || 0) + 1;

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

  return {
    success: true,
    business_line: businessLine,
    profile_id: existingProfile.profile_id,
    fingerprint,
    total_learned_reports: manifest.total_learned_reports,
    learned_items: {
      cause_rules: sanitized.cause_of_loss_rules?.length || 0,
      quantum_rubrics: sanitized.quantum_adjustment_rubrics?.length || 0,
      policy_principles: sanitized.policy_application_principles?.length || 0,
      phrasing_patterns: sanitized.adjuster_phrasing_and_tone?.length || 0,
    },
  };
}

/**
 * Retrieve all learned Brain profiles as style references compatible with referenceLayer.mjs.
 */
export async function getBrainStyleReferences() {
  await ensureBrainStorage();
  let files = [];
  try {
    files = await fs.readdir(PROFILES_DIR);
  } catch {
    return [];
  }

  const references = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = await fs.readFile(path.join(PROFILES_DIR, file), "utf8");
      const profile = JSON.parse(raw);
      if (!profile.business_line) continue;

      const styleNotes = [
        ...(profile.distinctive_best_practices || []).slice(0, 5),
        ...(profile.cause_of_loss_rules || []).slice(0, 4).map((r) => `[Cause standard] ${r.guidance || r.example_phrasing}`),
        ...(profile.quantum_adjustment_rubrics || []).slice(0, 4).map((q) => `[Adjustment standard] ${q.category}: ${q.decision_rule}`),
      ].filter(Boolean);

      references.push({
        profile_id: profile.profile_id || `brain_${file.replace(/\.json$/, "")}`,
        title: `Brain Learned Adjuster Wisdom: ${profile.business_line}`,
        section_order: [],
        style_notes: styleNotes,
        applies_to: {
          client_terms: [],
          evidence_terms_any: [],
          business_lines: [profile.business_line],
        },
        source_role: "style_reference_only",
        is_brain_knowledge: true,
        ingested_count: profile.ingested_reports_count || 1,
      });
    } catch {
      // Ignore corrupt profile files
    }
  }

  return references;
}

/**
 * Reset / purge a learned profile for a specific business line.
 */
export async function purgeBrainProfile(businessLineKey) {
  await ensureBrainStorage();
  const safeKey = businessLineKey.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const profilePath = path.join(PROFILES_DIR, `${safeKey}.json`);
  try {
    await fs.unlink(profilePath);
  } catch {
    // File may not exist
  }
  // Update manifest
  const manifest = await getBrainManifest();
  if (manifest.business_lines) {
    delete manifest.business_lines[safeKey];
  }
  if (Array.isArray(manifest.learned_reports)) {
    manifest.learned_reports = manifest.learned_reports.filter((r) => {
      const rKey = (r.business_line || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return rKey !== safeKey;
    });
    manifest.total_learned_reports = manifest.learned_reports.length;
  }
  manifest.updated_at = new Date().toISOString();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  return { ok: true, purged: safeKey };
}

/**
 * Remove a specific rule from a learned business line profile.
 */
export async function removeBrainRule(businessLineKey, category, ruleIndex) {
  await ensureBrainStorage();
  const safeKey = businessLineKey.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const profilePath = path.join(PROFILES_DIR, `${safeKey}.json`);
  let profile;
  try {
    const raw = await fs.readFile(profilePath, "utf8");
    profile = JSON.parse(raw);
  } catch {
    throw new Error("Profile not found");
  }

  const idx = Number(ruleIndex);
  if (Array.isArray(profile[category]) && profile[category][idx] !== undefined) {
    profile[category].splice(idx, 1);
    profile.last_updated = new Date().toISOString();
    await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
    return { ok: true, category, remaining: profile[category].length };
  }
  throw new Error(`Rule at index ${ruleIndex} in category ${category} not found.`);
}
