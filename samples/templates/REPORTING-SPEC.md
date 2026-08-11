# ULA Unified Reporting Specification

## Purpose

This specification converts the report patterns in `samples/` into one controlled ULA reporting system. It preserves the professional content and workflow of the samples while removing duplicated formatting, stale footers, manual page totals, inconsistent terminology, and sample claim data.

## Source analysis

The operational samples cover Air Shipment, Land Shipment, Marine Non-Reefer Cargo, Bulk Vessel Cargo, Fidelity, Property, and Yacht claims. The two Fidelity files are byte-for-byte duplicates. The Strategic Alliances documents are reusable corporate content rather than report types.

Every operational report follows the same underlying control pattern:

1. Cover and claim identification
2. Document control, confidentiality, authorship, and approval
3. Version history
4. Report summary and salient claim facts
5. Appointment, investigation, and findings
6. Cause of loss
7. Policy and coverage analysis
8. Claim calculation and adjustment
9. Recovery, salvage, liability, or specialist sections where applicable
10. Conclusion
11. Supporting and outstanding documents
12. Photographs and appendices
13. Controlled ULA corporate and legal content

## Controlled terminology

Use these canonical labels in the system and generated reports:

| Canonical term | Sample variations consolidated |
| --- | --- |
| Insurer | Applicant, insurer, insurance company |
| Insured | Assured, insured |
| Investigator / Attendee | Inspected by, attended by, investigated by |
| Preparer / Writer | Prepared by, written by |
| Reviewer | Reviewed by, prepared and reviewed by |
| Approver | Approved by, reviewed and approved by |
| Claimed amount | Claim amount, indemnity claimed |
| Adjusted amount | Concluded adjustment, adjusted claim |
| Supporting documents | Available documents, enclosed documents |
| Outstanding documents | Unavailable documents, pending documents |

Job titles remain separate from workflow assignments. A Claims Director may prepare one report and review another. Combined responsibilities are permitted only when explicitly assigned and recorded.

## Roles and permissions

| Workflow responsibility | Common designations found | Allowed actions | Restricted actions |
| --- | --- | --- | --- |
| Investigator / Attendee | ULA Correspondent Surveyor, Marine Surveyor, Technical Specialist | View assigned claim, upload evidence, record attendance and findings, caption photographs, submit investigation | Cannot approve or issue a final report |
| Preparer / Writer | Claims Administrator, Claims Handler, Liability Claims Manager, Claims Director | Edit claim facts, prepare report sections, build adjustment schedules, link evidence, submit for review | Cannot approve solely because they authored the report |
| Reviewer | Claims Director, Chartered Engineer, Average Adjuster, Loss Adjuster | Review all sections, comment, request changes, complete technical review | Cannot silently modify an issued report |
| Approver | Director, Chartered Engineer, Average Adjuster, Loss Adjuster | Approve, sign, issue final, authorize a revision | Cannot issue while required professional gates remain incomplete |
| Administrator | System administrator | Manage users, templates, shared clauses, legal variants, and access | Administrative access does not automatically grant professional approval authority |

The sample reports demonstrate valid combined assignments such as Prepared & Reviewed and Reviewed & Approved. The system must record each responsibility separately even when the same person holds more than one.

## Report lifecycle

1. **Evidence:** documents, photographs, and field notes are registered.
2. **Analysis:** facts are extracted or entered and linked to sources.
3. **Adjustment:** claimed, covered, deducted, depreciated, salvaged, and adjusted values are reviewed.
4. **Review:** a designated reviewer checks the full draft and returns or accepts it.
5. **Approval:** an authorized approver signs and issues a controlled version.

Supported issue states are Draft, In Review, Changes Requested, Preliminary, Final, and Revised Final. An issued report is immutable. Corrections create a new version with a reason for revision.

## AI rules

- AI may classify documents, suggest the line of business, extract candidate facts, summarize evidence, and draft report text.
- Every extracted fact must retain its source document, page or location when available, confidence, and review state.
- AI must use explicit placeholders such as `Requires confirmation` when evidence is absent.
- AI cannot make the final determination for cause of loss, policy coverage, liability, quantum, recommendations, or conclusions.
- Those professional sections require human review before submission and reviewer/approver gates before issue.
- Conflicting evidence must be shown as a conflict, not silently resolved.
- Generated text must never claim that OCR, vision, or external AI processing occurred when only the local development adapter was used.

## Canonical data groups

### Claim identity

ULA reference, report title, business line, insurer, insured, broker or agent, policy number, policy period, date of loss, date of intimation, appointment date, jurisdiction, currency, reserve, claimed amount, deductible, and adjusted amount.

### Document control

Investigator, preparer, reviewer, approver, professional designations, visit dates, approval date, signature status, confidentiality clause, version number, issue date, issue state, and reason for revision.

### Evidence provenance

Evidence ID, file metadata, category, source location, extracted facts, linked report statements, linked adjustment lines, reviewer status, and storage reference. Binary files remain outside localStorage.

### Adjustment schedule

Line ID, description, invoice or quotation reference, claimed quantity, claimed unit rate, claimed amount, coverage position, depreciation, deductible allocation, salvage or recovery, adjusted amount, currency, comments, and evidence links.

## Line-of-business modules

### Air Shipment

Shipper, consignee, carrier or forwarder, air waybill, booking note, origin, destination, commodity, interest insured, warranties and conditions, appointment of assessors, and adequacy of insured value.

### Land Shipment

Shipper, consignee, Incoterm, commodity, truck waybill, vehicle, trailer, driver, road routing, transport circumstances, and interest insured.

### Marine Cargo

Shipper, consignee, bill of lading, commodity, vessels, ports, transshipment, inland leg, survey parties, notice of claim, voyage or weather conditions, timing of damage, and insured value. Reefer claims add temperature and cold-chain records.

### Bulk Vessel

Reinsurance broker, agent, insurer, buyer, sellers, charterer, P&I, stevedore, vessel, cargo certificates, sales contract, survey timeline, joint survey parties, notices and reservations, warehouse findings, recovery, merits, and salvage.

### Fidelity

Employee details, coverage period, incident particulars, investigation meetings, statements, special clauses, accounts warranty, non-accumulation terms, client and invoice ledger, and fidelity adjustment.

### Property

Business and premises, occupancy, loss history, discovery, spread and mitigation, extent of damage, fire or incident investigation, protections, visits, invoice schedule, warranties, and adequacy of sums insured.

### Yacht

Yacht name, home port, registration, engines, coverage clauses, circumstances, occurrence and attendance dates, repair schedule, jurisdiction, and relevant adjustment practice.

## Unified template rules

- One cover hierarchy and one document-control table across every report.
- One controlled disclaimer and one controlled ULA corporate section; do not duplicate them inside reports.
- Use dynamic page numbering, total pages, table of contents, version, form code, issue date, and legal footer.
- Dates use `DD Month YYYY`; currencies use ISO code plus formatted amount, for example `USD 118,720.00`.
- Preliminary and final states use the same template. State and revision reason change through metadata.
- Client logos are optional controlled assets, never unresolved `[Insert here client logo]` placeholders.
- Photographs require evidence IDs, captions, dates when known, and source references.
- Every adjustment line must reconcile to the report totals.
- Templates contain placeholders only and no sample claimant, policy, employee, vessel, invoice, or financial data.

## Current implementation boundary

The project now contains the template schema and local workflow adapter. Local analysis is intentionally conservative and does not pretend to perform external OCR or AI extraction. Production implementation still requires an external AI/OCR provider, durable database, object storage or SharePoint adapter, identity provider, role assignment administration, electronic signature policy, and final legal-entity/footer configuration.

