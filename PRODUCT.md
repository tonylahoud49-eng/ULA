# ULA Claims Hub

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- ULA field investigators, attending surveyors, correspondent surveyors, and technical specialists who collect evidence and record findings.
- Claims administrators, handlers, and managers who prepare claim files, adjustments, and draft reports.
- Claims directors and senior technical reviewers who review reports and request corrections.
- Directors and appropriately designated chartered loss or average adjusters who approve and sign final reports.
- Administrators who manage access, controlled templates, shared corporate content, and supporting staff workflows.

Job titles and workflow permissions are separate. A person may be assigned more than one workflow responsibility on a report when authorized, as shown by the sample reports' combined "prepared and reviewed" and "reviewed and approved" assignments.

## Product Purpose

ULA Claims Hub supports claim intake, evidence management, investigation, adjustment, controlled report drafting, review, approval, versioning, and related internal operations. Success means that a claim team can move from source evidence to a consistent ULA report without losing traceability, professional judgment, or approval control.

## Positioning

The product turns ULA's real loss-adjusting report practices into an evidence-linked workflow with one controlled report framework and specialized modules for each line of business.

## Operating Context

- Claims may involve air shipment, land shipment, marine non-reefer cargo, bulk vessel cargo, fidelity, property, or yacht losses.
- Source material includes policies, invoices, transport documents, survey notes, correspondence, photographs, calculations, notices, and other uploaded evidence.
- Reports progress through investigation or attendance, preparation, review, approval, and versioned issue states such as preliminary, final, and revised final.
- AI may classify evidence and draft content, but professional users must review its output before it is used in a report.
- The current application is a React, Vite, and Tailwind web application. Its existing pages, routes, workflows, features, and business behavior must remain recognizable during the redesign.

## Capabilities and Constraints

- Use one unified ULA master report structure with line-of-business-specific fields, sections, calculations, and appendices.
- Preserve an evidence trail between uploaded documents, extracted facts, report statements, photographs, and adjustment lines.
- AI is draft-only for cause of loss, coverage analysis, adjustment or quantum, liability, recommendations, and conclusions. It cannot approve or finalize a report.
- Report permissions follow assigned workflow responsibilities: investigator or attendee, preparer or writer, reviewer, and approver. Administrative access does not automatically grant professional approval authority.
- Final approval requires an authorized approver, approval date, report version, and an auditable status transition. Revisions after approval create a new version rather than silently changing the issued report.
- Uploaded binary documents remain outside localStorage. The current independent storage implementation is suitable for local development and must remain replaceable by a backend or SharePoint storage provider.
- The redesign must not remove features, change established routes or user flows, or alter business logic except where required to implement the confirmed reporting workflow safely.
- Open decisions: final DOCX/PDF export requirements, legal-entity and office-specific footer variants, production backend/storage provider, and the official vector logo source.

## Brand Commitments

- Product and organization name: ULA / United Loss Adjusters & Surveyors.
- Existing mark: green ULA wordmark with the line motif and the tagline "End-to-end global solutions," embedded consistently in the operational report samples.
- Use a unified report presentation rather than preserving inconsistent formatting from individual samples.
- The extracted raster logo may be used as a temporary source asset. Replace it with an official vector asset when supplied.
- The experience must remain professional, precise, evidence-led, and appropriate for insurer, broker, assured, legal, and technical audiences.

## Evidence on Hand

- Eleven Word documents in `samples/`, including operational report examples for seven lines of business and two strategic-alliance content files.
- `b23e3673e_FidelitySample.docx` and `Fidelity Sample.docx` are exact duplicates.
- The operational samples contain reusable document-control tables, approval assignments, version histories, claim summaries, adjustment schedules, legal wording, appendices, and embedded ULA raster logo assets.
- The Strategic Alliances documents are shared corporate content, not report types.
- No official vector logo, complete brand manual, or confirmed production backend specification is currently present in the project.

## Product Principles

1. Evidence before inference: every material report statement should be traceable to claim data or source evidence.
2. Human judgment is final: AI accelerates drafting but never replaces professional review or approval.
3. One controlled core, specialized where necessary: shared structure and terminology with line-of-business modules.
4. Responsibility is explicit: workflow assignments, professional titles, signatures, dates, and version transitions remain auditable.
5. Preserve the working product: improve clarity and craft without removing features or disrupting established tasks.

## Accessibility & Inclusion

The redesigned web application must support keyboard operation, visible focus, semantic controls, readable contrast, responsive layouts, reduced-motion preferences, clear validation, and understandable status and error messages.
