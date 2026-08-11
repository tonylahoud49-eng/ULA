import {
  getReportTemplate,
  reportAssignments,
  reportReadiness,
} from "@/lib/reportTemplates";

const confirmed = (value, fallback = "Requires confirmation — source evidence not provided") =>
  value === undefined || value === null || value === "" ? fallback : value;

const uniqueSections = (sections) => sections.filter((section, index, items) =>
  items.findIndex((candidate) => candidate.id === section.id) === index,
);

export function createLocalReportAnalysis({ claim, documents }) {
  const readiness = reportReadiness(claim, documents);
  const classified = claim.business_line && claim.business_line !== "Unclassified";
  const confidence = Math.min(92, Math.max(classified ? 45 : 20, Math.round(readiness.overallProgress * 0.8)));

  return {
    ...claim,
    business_line: claim.business_line || "Unclassified",
    template_id: readiness.template.id,
    template_name: readiness.template.name,
    confidence,
    missing_fields: readiness.missingFields,
    missing_documents: readiness.missingDocuments,
    field_progress: readiness.fieldProgress,
    document_progress: readiness.documentProgress,
    overall_progress: readiness.overallProgress,
    section_readiness: uniqueSections(readiness.template.sections).map((section) => ({
      id: section.id,
      title: section.title,
      owner: section.owner,
      human_approval_required: Boolean(section.humanApproval),
    })),
    evidence_sources: documents.map((document, index) => ({
      id: `E-${String(index + 1).padStart(2, "0")}`,
      field: document.category || document.file_type || "Uploaded evidence",
      source: document.file_name,
      confidence: "Source registered",
      review_state: "Needs professional review",
    })),
    human_review_required: [
      "Cause of loss",
      "Policy coverage",
      "Adjustment",
      "Liability",
      "Recommendations",
      "Conclusion",
    ],
    summary: `${readiness.template.name} selected from the claim business line. ${documents.length} source document(s) are registered; local development mode checks completeness but does not perform external OCR or AI extraction.`,
  };
}

export function createUnifiedReportDraft({ claim, documents, versions, generatedBy }) {
  const template = getReportTemplate(claim.business_line);
  const readiness = reportReadiness(claim, documents);
  const assignments = reportAssignments(claim, generatedBy);
  const versionNumber = versions.length + 1;
  const issueDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const amount = (value) => Number.isFinite(Number(value))
    ? `${claim.currency || "USD"} ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "Requires confirmation";
  const supportingDocuments = documents.length
    ? documents.map((document, index) =>
      `- **E-${String(index + 1).padStart(2, "0")}** — ${document.file_name} (${document.category || document.file_type || "Other"})`,
    ).join("\n")
    : "- No supporting documents registered";
  const outstandingDocuments = readiness.missingDocuments.length
    ? readiness.missingDocuments.map((item) => `- ${item}`).join("\n")
    : "- No template-required document category is currently flagged as missing";
  const photos = documents.filter((document) =>
    document.file_type === "Photo" || document.category === "Photo Evidence",
  );

  const sectionBody = (section) => {
    switch (section.id) {
      case "executive_summary":
        return `This is a controlled **Draft** prepared using the ${template.name}. It is based on registered claim metadata and ${documents.length} source document(s). Local development mode does not perform external OCR or make professional determinations. Cause, coverage, adjustment, liability, recommendations, and conclusion require human review.`;
      case "appointment":
        return confirmed(claim.description, "The appointment scope and instructions require confirmation from the claim file.");
      case "investigation":
      case "surveyor_notes":
      case "survey_timeline":
        return `Investigation narrative requires preparation by the assigned investigator. Registered evidence: ${documents.length} item(s).`;
      case "cause":
        return `${confirmed(claim.cause_of_loss)}\n\n> **Professional review required:** the proximate cause and contributing factors must be confirmed by the designated reviewer.`;
      case "coverage":
        return `Policy ${confirmed(claim.policy_number)} with stated limit ${amount(claim.policy_limit)} and deductible ${amount(claim.deductible)}. Terms, conditions, warranties, exclusions, insurable interest, and the final coverage position require review against the complete policy.`;
      case "adjustment":
        return `| Item | Amount | Review state |\n| --- | ---: | --- |\n| Claimed amount | ${amount(claim.claim_amount)} | Requires evidence reconciliation |\n| Deductible | ${amount(claim.deductible)} | Requires policy confirmation |\n| Adjusted amount | ${amount(claim.adjusted_amount)} | Requires professional approval |`;
      case "conclusion":
        return "No final conclusion has been issued. The designated reviewer and approver must confirm the complete evidence record, cause, coverage position, and adjustment before issue.";
      case "supporting_documents":
        return supportingDocuments;
      case "outstanding_documents":
        return outstandingDocuments;
      case "appendices":
        return photos.length
          ? photos.map((document, index) =>
            `- **P-${String(index + 1).padStart(2, "0")}** — ${document.file_name}; caption and source date require confirmation`,
          ).join("\n")
          : "- No photo evidence registered";
      case "corporate":
        return "Controlled ULA corporate and strategic-alliance wording is inserted from the approved shared content block at export time.";
      default:
        return `{{${section.id}}}\n\nThis line-of-business section requires completion and evidence linkage by the assigned ${section.owner}.`;
    }
  };

  const bodySections = uniqueSections(template.sections)
    .filter((section) => !["cover", "document_control", "version_history", "claim_facts"].includes(section.id))
    .map((section) => `## ${section.title}\n\n${sectionBody(section)}`)
    .join("\n\n");
  const roleRows = assignments
    .map((assignment) => `| ${assignment.label} | ${assignment.name} | ${assignment.designation} | Pending |`)
    .join("\n");

  const content = `# ${confirmed(claim.claim_number, "ULA Claim Report")}

**${template.name} · Draft · Version ${versionNumber}**

## Cover Page

- **Claim:** ${confirmed(claim.title)}
- **Business Line:** ${confirmed(claim.business_line, "Unclassified")}
- **Insured:** ${confirmed(claim.insured)}
- **Insurer:** ${confirmed(claim.insurer)}
- **Date of Loss:** ${confirmed(claim.date_of_loss)}
- **Date of Issue:** ${issueDate}

## Document Control

| Responsibility | Assigned person | Designation | State |
| --- | --- | --- | --- |
${roleRows}

This report is issued without prejudice to the rights and defences of all parties concerned.

## Version History

| Version | Date of issue | Issue state | Reason for revision |
| --- | --- | --- | --- |
| ${versionNumber} | ${issueDate} | Draft | Initial controlled draft |

## Claim Salient Details

| Field | Value |
| --- | --- |
| ULA Reference | ${confirmed(claim.claim_number)} |
| Policy Number | ${confirmed(claim.policy_number)} |
| Broker / Agent | ${confirmed(claim.broker)} |
| Country | ${confirmed(claim.country)} |
| Claimed Amount | ${amount(claim.claim_amount)} |
| Deductible | ${amount(claim.deductible)} |
| Template Readiness | ${readiness.overallProgress}% |

${bodySections}`;

  return {
    content,
    template,
    readiness,
    assignments,
    versionNumber,
    issueDate,
  };
}
