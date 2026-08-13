import {
  getReportTemplate,
  reportAssignments,
  reportReadiness,
} from "@/lib/reportTemplates";

const cleanValue = (value, fallback = "To be confirmed") =>
  value === undefined || value === null || String(value).trim() === "" ? fallback : value;

const uniqueSections = (sections) => sections.filter((section, index, items) =>
  items.findIndex((candidate) => candidate.id === section.id) === index,
);

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
    : "To be quantified";

  const claimedVal = Number(claim.claim_amount) || 0;
  const deductibleVal = Number(claim.deductible) || 0;
  const adjustedVal = Number(claim.adjusted_amount) || Math.max(0, claimedVal - deductibleVal);

  const supportingDocuments = documents.length
    ? documents.map((document, index) =>
      `- **E-${String(index + 1).padStart(2, "0")}** — ${document.file_name} (${document.category || document.file_type || "Commercial Evidence"})`,
    ).join("\n")
    : "- Document registry to be populated upon receipt of primary claim file.";

  const outstandingDocuments = readiness.missingDocuments.length
    ? readiness.missingDocuments.map((item) => `- ${item}`).join("\n")
    : "- All requisite primary claim and transit documents have been registered.";

  const photos = documents.filter((document) =>
    document.file_type === "Photo" || document.category === "Photo Evidence" || /\.(png|jpe?g|webp)$/i.test(document.file_name),
  );

  const sectionBody = (section) => {
    switch (section.id) {
      case "executive_summary":
        return `At the request of **${cleanValue(claim.insurer, "the Insurer / Applicant")}**, United Loss Adjusters & Surveyors (ULA) was appointed to attend, investigate, and assess the circumstances surrounding the reported loss concerning **${cleanValue(claim.insured, "the Assured")}**.\n\nThis controlled assessment is compiled on the basis of primary evidence, technical survey findings, and governing terms of Policy No. **${cleanValue(claim.policy_number, "underlying policy")}**. All assessments are issued strictly without prejudice to liability.`;
      
      case "appointment":
        return `ULA was instructed to conduct a thorough investigation and quantum adjustment regarding the subject loss at **${cleanValue(claim.country, "the designated location")}**.\n\n**Scope of Appointment:**\n- Verify insurable interest and governing policy coverage.\n- Investigate the proximate cause, nature, and extent of the claimed damages/loss.\n- Assess quantum, salvage potential, and mitigation measures.\n- Evaluate recovery and third-party recourse potential.`;
      
      case "investigation":
      case "surveyor_notes":
      case "survey_timeline":
        return `${cleanValue(claim.description, "Surveyor attended the loss location to conduct physical inspection and document verification.")}\n\nEvidence examined includes ${documents.length} registered document(s), delivery receipts, and contemporaneous records. Inspection confirmed the sequence of events leading to the notified loss.`;
      
      case "cause":
        return `Based on physical inspection, documentary review, and operational records, the proximate cause of loss is determined as:\n\n**${cleanValue(claim.cause_of_loss, "Transit / Operational Incident resulting in physical loss or damage.")}**\n\nNo evidence of non-disclosure, gross negligence, or unapproved deviation was noted during the preliminary review.`;
      
      case "coverage":
        return `The claim falls for consideration under Policy No. **${cleanValue(claim.policy_number)}** issued in favor of **${cleanValue(claim.insured)}**.\n\n- **Sum Insured / Limit:** ${amount(claim.policy_limit || claim.claim_amount)}\n- **Applicable Deductible:** ${amount(claim.deductible)}\n- **Conditions & Warranties:** Institute and commercial standard conditions apply. The loss falls within the operative clause of the policy subject to standard deductible application.`;
      
      case "adjustment":
        return `The claim calculation and adjustment have been reconciled as follows:\n\n| Adjustment Item | Claimed Amount | Policy Basis | Concluded Amount |\n| --- | ---: | --- | ---: |\n| Gross Claimed Quantum | ${amount(claimedVal)} | Invoice / Valuation | ${amount(claimedVal)} |\n| Policy Deductible | — | Agreed Deductible | (${amount(deductibleVal)}) |\n| Salvage / Recovery Credit | — | Net Realizable | $0.00 |\n| **Net Concluded Adjustment** | **${amount(claimedVal)}** | **Payable Quantum** | **${amount(adjustedVal)}** |\n\n*Subject to presentation of final documentation and formal settlement release.*`;
      
      case "conclusion":
        return `Subject to final underwriters' instructions and verification of any pending formal documents, ULA recommends adjustment in the net sum of **${amount(adjustedVal)}**.\n\nThis report is issued without prejudice to the rights and defenses of underwriters and all interested parties.`;
      
      case "supporting_documents":
        return supportingDocuments;
      
      case "outstanding_documents":
        return outstandingDocuments;
      
      case "appendices":
        return photos.length
          ? photos.map((document, index) =>
            `- **Appendix A-${String(index + 1).padStart(2, "0")}** — Representative photograph: *${document.file_name}*`,
          ).join("\n")
          : "- Representative survey photographs and transport receipts on file.";
      
      case "corporate":
        return `**United Loss Adjusters & Surveyors (ULA)** provides comprehensive international claims management, surveying, risk management, and average adjusting services across the UK, Europe, and Middle East.`;
      
      default:
        return `${cleanValue(claim.description, "Line-of-business specific assessment conducted in accordance with international surveying standards.")}`;
    }
  };

  const bodySections = uniqueSections(template.sections)
    .filter((section) => !["cover", "document_control", "version_history", "claim_facts"].includes(section.id))
    .map((section) => `## ${section.title}\n\n${sectionBody(section)}`)
    .join("\n\n");

  const roleRows = assignments
    .map((assignment) => `| ${assignment.label} | ${assignment.name} | ${assignment.designation} | Signed & Validated |`)
    .join("\n");

  const content = `# ${cleanValue(claim.claim_number, "ULA Claim Report")}

**${template.name} · Version ${versionNumber}**

## Cover Page

- **Claim:** ${cleanValue(claim.title)}
- **Business Line:** ${cleanValue(claim.business_line, "Commercial Claims")}
- **Insured:** ${cleanValue(claim.insured)}
- **Insurer:** ${cleanValue(claim.insurer)}
- **Date of Loss:** ${cleanValue(claim.date_of_loss)}
- **Date of Issue:** ${issueDate}

## Document Control

| Responsibility | Assigned person | Designation | Status |
| --- | --- | --- | --- |
${roleRows}

This survey and its issued report were completed without prejudice to all rights of parties concerned.

## Version History

| Version | Date of issue | Issue state | Reason for revision |
| --- | --- | --- | --- |
| ${versionNumber} | ${issueDate} | Issued - Final | Controlled Loss Adjusting Survey Report |

## Claim Salient Details

| Field | Value |
| --- | --- |
| ULA Reference | ${cleanValue(claim.claim_number)} |
| Policy Number | ${cleanValue(claim.policy_number)} |
| Broker / Agent | ${cleanValue(claim.broker, "Direct / London Market")} |
| Jurisdiction / Country | ${cleanValue(claim.country, "United Kingdom / International")} |
| Claimed Amount | ${amount(claimedVal)} |
| Policy Deductible | ${amount(deductibleVal)} |
| Net Adjusted Amount | ${amount(adjustedVal)} |

${bodySections}

## About ULA

**United Loss Adjusters and Surveyors (ULA)** is a leading international provider of Adjusters, Surveyors, Solicitors and Consultants, offering unrivalled technical and legal solutions with exclusive access to the London Market's leading specialists.

Founded in 2002, with strategic head offices in the Middle East and the United Kingdom, today ULA is the strategic ally of a world leading legal firm (with offices in over 60 major countries) and the correspondent for a number of global technical service providers (with offices in 140+ countries), with principals including but not limited to Insurers, Reinsurers, Brokers, P&I clubs, Ship Owners, Shipyards and Agencies.

### Lines of business:
- Insurance & Re-insurance
- Claims solutions and loss adjusting across all major lines: aviation, cargo, marine, property, fine arts and special risks claims
- Cargo & Containers
- Marine & Offshore
- Global Claim Recoveries & Legal Support

### Our team:
Our team of qualified professionals experienced in the fields of Marine, Insurance, Finance, Engineering and Law known and respected for their integrity and credibility. Supported by a highly mobile team strategically positioned where our services are needed, we are always available on short notice to deal promptly with your queries. ULA is independent to the core and can be trusted to express unbiased views, and is not influenced by stakeholders.

### Recognised Memberships:
- The Association of Average Adjusters (AAA)
- The Bar Council of England and Wales
- The Chartered Insurance Institute (CII)
- The Chartered Institute of Loss Adjusters (CILA)
- The European Federation of Loss Adjusting Experts (FUEDI)
- The Institute of Marine Engineering, Science and Technology (IMarEST)
- The Royal Institution of Naval Architects (RINA)
- The Royal Institution of Chartered Surveyors (RICS)
`;

  return {
    template,
    assignments,
    readiness,
    versionNumber,
    issueDate,
    content,
  };
}
