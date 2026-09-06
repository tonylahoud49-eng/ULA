/**
 * Strict REPORT_SPEC.md Director Requirements Quality Gate and Assembler
 */
export function assembleMasterAgentReport({
  claim = {},
  audit = {},
  quantum = {},
  reconciliation = {},
}) {
  const currency = quantum.currency || claim.currency || "USD";
  const netAmount = Number(quantum.net_indemnity || 0);
  const formattedAmount = netAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 1. Conclusion Point 1 - Amount (REPORT_SPEC.md lines 221-232)
  const point1 = netAmount >= 0 && quantum.net_indemnity !== undefined
    ? `The above adjusted claim amount ${currency} ${formattedAmount} is considered fair & reasonable.`
    : `The above adjusted claim amount in ${currency} cannot be stated as fair & reasonable because the reviewed file requires a reconciled adjustment schedule, supported quantities, rates, and deductions.`;

  // 2. Conclusion Point 2 - Cause (REPORT_SPEC.md lines 233-236)
  const point2 = audit.cause_of_loss || "The proximate cause of loss is not expressly stated as a source fact; the available evidence supports the qualified professional assessment set out below.";

  // 3. Conclusion Point 3 - Cover advice (REPORT_SPEC.md lines 237-250)
  const point3 = audit.cover_advice || "Cover advice: The identified policy warranties, exclusions, valuation provisions, and other operative terms must be applied to the established facts before cover is confirmed; final cover remains subject to professional review and approval.";

  // 4. Conclusion Point 4 - Liable-party position (REPORT_SPEC.md lines 251-260)
  const point4 = audit.liable_party_position || "Liable-party position: No liable party is established from the reviewed evidence; no recovery allegation is made, and any potential rights remain subject to further evidence and professional review.";

  // 5. Conclusion Point 5 - Fixed closing verbatim (REPORT_SPEC.md lines 261-267)
  const point5 = "We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions.";

  // Quality gate checks (REPORT_SPEC.md lines 323-327)
  const blockers = [];
  if (netAmount < 0) blockers.push("Negative reportable indemnity");
  if (!currency) blockers.push("Missing ISO currency");
  if (point1.includes("not established") || point2.includes("not established")) {
    blockers.push("Prohibited phrase 'not established' detected in client narrative");
  }

  return {
    claim_id: claim.id,
    title: claim.title,
    business_line: claim.business_line,
    appointment_of_assessors: "To date, it is understood that the Assured had not appointed a loss assessor to act on their behalf.",
    adequacy_of_insured_value: quantum.adequacy_statement,
    conclusion_points: [point1, point2, point3, point4, point5],
    quantum,
    reconciliation,
    audit,
    passed_quality_gate: blockers.length === 0,
    quality_gate_blockers: blockers,
    assembled_at: new Date().toISOString(),
  };
}
