# ULA Approved Report Specification

## Status and scope

This file records the report rules implemented in the current ULA production code and enforced by the current report tests as of 31 August 2026. It is the mandatory reference for report-related work.

This specification covers AI claim analysis, normalized facts, professional reasoning, calculations, report narrative, master DOCX export, evidence provenance, historical style references, and photograph selection. It does not authorize a change to production behavior.

The controlling implementation is primarily in:

- `server/ai/providers/openaiProvider.mjs`
- `server/ai/providers/anthropicProvider.mjs`
- `server/ai/claimAnalysisSchema.mjs`
- `server/ai/referenceLayer.mjs`
- `server/ai/references/gfs-reefer-approved.json`
- `server/ai/references/bulk-vessels-approved.json`
- `server/ai/references/air-shipments-approved.json`
- `server/ai/references/land-shipments-approved.json`
- `server/ai/references/non-reefer-cargo-approved.json`
- `src/lib/reportingEngine.js`
- `src/lib/masterReportDocx.js`
- `src/lib/reportPhotoSelection.js`
- `src/lib/reportTemplates.js`
- `server/tests/professional-report-narrative.test.mjs`
- `server/tests/master-report-docx.test.mjs`
- `server/tests/reporting-engine.test.mjs`

## Approved report structure and section order

The master report uses this order:

1. Cover Page
2. Document Control Page
3. Version History
4. Report Summary
5. Report and adjustment note
6. Table 1 - Summary and salient details
7. INTEREST INSURED & RELEVANT CONDITIONS OF INSURANCE POLICY
8. SHIPMENT ROUTING, for Marine Cargo, Bulk Vessel, Air Shipment, and Land Shipment reports
9. SURVEYOR NOTES
10. CAUSE OF LOSS
11. RELEVANT POLICY WARRANTIES & CONDITIONS
12. ADEQUACY OF THE INSURED VALUE
13. APPOINTMENT OF ASSESSORS
14. CLAIM PRESENTED ON THE POLICY & ADJUSTMENT
15. Table 2 - Claim presented by the Assured & Adjustment
16. CONCLUSION
17. Enclosure to this report
18. Outstanding Documents
19. Appendix A - Photographs, when photographs are available
20. About ULA / controlled corporate material

`SHIPMENT ROUTING` is inserted immediately after the insured-interest section only for shipment business lines. Specialist line-of-business sections may be added only where the selected template requires them, without displacing the approved master sections.

`Enclosure to this report` and `Outstanding Documents` are title-only sections in the issued DOCX. Their contents are supplied separately and must not be auto-populated beneath the headings.

The Appendix contains photographs, not document reproductions or lists of supporting documents.

## DOCX paragraph formatting

Generated narrative paragraphs use justified alignment and single line spacing. In WordprocessingML this is represented by `w:jc w:val="both"` and `w:spacing w:line="240" w:lineRule="auto"`. The rule applies to generated report narrative, while headings, cover-page typography, document-control layout, tables, signatures, photographs, headers, and footers retain their approved alignment and layout.

## The five Director requirements

The current tests treat the following as the five Director-controlled requirements.

### 1. Report Summary

The Report Summary must appear in this order:

1. The claim-specific Introduction.
2. A short sentence beginning `In brief, Table 1 records`.
3. The approved summary table containing:
   - `Assured's / Shipper's Name`
   - `Consignee's Name`
   - `Insurance Policy`
4. The heading `In our opinion`.
5. The same five ordered conclusion points defined below.

If an uploaded current-claim report contains an Introduction section, preserve its substantive wording verbatim with claim-evidence provenance. If no supported Introduction exists, generate a concise appointment-and-scope introduction from supported current-claim facts.

Do not insert internal review warnings, conflict diagnostics, `The following was concluded`, or `End of adjustment note` into the client narrative.

### 2. Cause of Loss

Apply the Cause of Loss rules in the dedicated section below. The section must begin with one of the approved proximate-cause lead forms and must distinguish source fact from professional opinion.

### 3. Adequacy of the Insured Value

Apply the deterministic adequacy and underinsurance rules below. Never state adequate insurance or underinsurance unless the required comparable values and valuation basis are supported.

### 4. Appointment of Assessors

The section contains exactly this sentence:

> To date, it is understood that the Assured had not appointed a loss assessor to act on their behalf.

Do not paraphrase, expand, or replace this sentence without Director approval.

### 5. Conclusion

The Conclusion uses the heading `In our opinion` and contains exactly five points in this order:

1. Adjusted claim amount / fair-and-reasonable position.
2. Cause of loss position.
3. Cover advice.
4. Liable-party / recovery position.
5. The fixed document-sighting closing sentence.

The same ordered five points are also used in the Report Summary opinion block.

## Cause of Loss wording and logic

The section is evidence-led and normally contains no more than five concise paragraphs.

### Approved opening

Use one of these three openings:

1. When an express cause is supported as a source fact:

   `The proximate cause of loss is {supported source-stated cause}.`

2. When no source expressly states the cause but supported evidence permits a qualified professional assessment:

   `The proximate cause of loss is not expressly established as a source fact; the available evidence supports the qualified professional assessment set out below.`

3. When neither an express cause nor a defensible evidence-based assessment is available:

   `The proximate cause of loss is not established from the available evidence.`

### Reasoning sequence

After the opening, use the following sequence where the evidence permits:

1. Material observed physical or survey circumstances.
2. Causal indicators and their significance.
3. A clearly labelled professional opinion, normally beginning `In our opinion` or `On the available evidence`.
4. Competing explanations that remain open.
5. Material limitations or the exact evidence gap preventing a stronger opinion.

An observed condition, discovery date, intact seal, packing condition, or other indicator is not automatically the proximate cause. A source-stated cause remains subject to professional verification of its mechanism and policy significance.

For shortage or non-delivery, assess the shipped quantity, total and per-container shortage, who counted and witnessed each count, seal history and condition, tampering or forced entry, origin loading evidence, carrier attendance or certificate, timing, competing explanations, and decisive gaps. An intact seal may weaken a sealed-transit removal hypothesis but does not by itself prove origin shortage or packing error.

For temperature claims, distinguish measured logger evidence from a condition merely compatible with temperature damage. Test origin condition, handling, packaging, timing, logger completeness, calibration, and alternative deterioration mechanisms.

Do not use `not established` as a substitute for reasoning. First test the material hypotheses. If the issue remains unresolved, explain why and identify the evidence that could distinguish the alternatives.

## Adequacy of the Insured Value and underinsurance

The application performs this comparison deterministically; Claude does not calculate it.

A definitive adequacy statement is permitted only when all of the following are supported:

- invoice total;
- insured value;
- ISO currency;
- valuation basis, either as supported wording or a supported uplift percentage.

The calculation is:

```text
required insured value = invoice total × (1 + evidenced uplift percentage / 100)
underinsurance = required insured value - documented insured value
```

The comparison allows a 0.01 rounding tolerance in the single supported reporting currency. The insured value is adequate when:

```text
documented insured value + 0.01 >= required insured value
```

When adequate, the conclusion must state that the invoice values are adequately insured and there is no underinsurance on the evidenced valuation basis.

When inadequate, the conclusion must state that the invoice values are not adequately insured and give the deterministic underinsurance difference in the supported currency.

When the required comparable evidence is incomplete or conflicting, use this exact fallback:

> Whether the invoice values are adequately insured and whether there is underinsurance cannot be established from the available evidence because a comparable invoice value, insured value, currency, and evidenced valuation basis are not all available.

Do not substitute the policy limit, per-conveyance limit, shipment value, or presented claim for a missing comparable input. Per-conveyance adequacy remains a separate professional issue where allocation between conveyances is not established.

## Claim adjustment and deterministic calculations

Claude extracts source-stated quantities, rates, monetary values, deductions, and valuation terms. The application layer performs arithmetic and reconciliation.

Keep these values separate:

- invoice total and its FOB, freight, and insurance components;
- separate freight invoice;
- insured value or policy limit;
- presented claim;
- itemized damaged, missing, repair, fee, salvage, recovery, depreciation, and deductible values;
- adjusted amount and concluded indemnity;
- valuation basis, percentage, and uplift amount.

Valid adjustment rows are evidenced damaged or missing property, repair costs, loss-related fees, or supported deductions. Policy limits, sums insured, shipment values, invoice or FOB totals, premium, valuation basis, and freight totals are not loss rows. Never add a full shipment value to the damaged-item value.

A quotation, estimate, pro-forma invoice, repair proposal, or supplier offer is provisional valuation evidence. It is not automatically a presented claim, incurred cost, accepted repair, or fair-and-reasonable adjusted amount. A presented claim must be supported independently by a claim form, demand, ledger, paid invoice, or clear claim correspondence. Quotation-based rows may remain in the adjustment table when clearly described as provisional valuation evidence.

Deductible wording is retained and parsed as a formula. The application keeps separate the percentage, monetary minimum, monetary maximum, fixed each-loss amount, franchise, currency, and annual/aggregate basis. A percentage and a minimum must never be concatenated into one monetary number. For an ordinary percentage deductible, the application calculates the percentage against the supported adjusted-loss basis, applies the supported minimum and maximum, and uses an explicit claim-specific deduction row in preference when reconciled. Aggregate erosion and franchise effect are not applied automatically without the required claim-specific evidence. A deductible in a different currency is not converted or applied without an evidenced conversion basis.

The calculation order is:

1. Reconcile each supported line, including quantity × rate where available.
2. Sum valid adjustment lines.
3. Apply only the evidenced valuation uplift.
4. Deduct the supported deductible, salvage, recovery, and depreciation.
5. Compare any source-stated adjusted amount with the deterministic result.

Unknown values are not zero. A concluded indemnity is produced only when a supported explicit adjusted amount exists or every required calculation input is available. Arithmetic conflicts remain visible for professional review. A reportable indemnity is never negative; where supported deductions exceed the supported loss, the provisional payable is floored at zero and the calculation remains visible for review.

The statement `fair & reasonable` is allowed only when there is one supported ISO reporting currency and a non-negative reconciled adjusted amount supported by an adjusted-amount fact or a validated non-quotation itemized schedule, with valid arithmetic. Otherwise use the unsupported-amount conclusion wording below.

## Conclusion exact order and wording

### Point 1 - amount

When supported:

> The above adjusted claim amount {ISO currency} {formatted amount} is considered fair & reasonable.

When not supported:

> The above adjusted claim amount in {supported ISO currency} cannot be stated as fair & reasonable because a fully supported and reconciled adjusted amount is not established from the reviewed evidence.

When no single reporting currency is supported, replace `in {supported ISO currency}` with `in a single reporting currency`. When the amount is supported only by quotation or estimate evidence, append that limitation expressly.

### Point 2 - cause

Use the strongest approved Cause of Loss sentence produced under the cause logic above. It must remain source-stated or expressly qualified as professional opinion; it must not convert an indicator or unresolved conflict into fact.

### Point 3 - cover advice

When a sourced coverage finding exists:

> Cover advice: {supported coverage finding} This remains subject to the operative policy wording and professional approval.

When policy wording exists but no specific sourced coverage finding controls:

> Cover advice: The identified policy warranties, exclusions, valuation provisions, and other operative terms must be applied to the established facts before cover is confirmed; final cover remains subject to professional review and approval.

When operative wording is absent:

> Cover advice: The operative policy wording is not established from the reviewed evidence, so cover cannot be advised without inventing terms and remains subject to professional review.

### Point 4 - liable-party position

When a supported potential carrier or contractual recovery issue exists:

> Liable-party position: {supported recovery assessment} No liable party is held automatically without the supporting contract, notice, causation, and liability evidence.

Otherwise:

> Liable-party position: No liable party is established from the reviewed evidence; no recovery allegation is made, and any potential rights remain subject to further evidence and professional review.

### Point 5 - fixed closing

Use exactly:

> We confirm having sighted the originals of all documents customarily submitted in support of a claim of this nature and remain at Insurers disposal for further instructions.

The wording is intentionally recorded exactly as implemented, including `Insurers disposal` without an apostrophe. Do not silently grammar-correct it.

## Claude professional reasoning rules

Claude must analyze the complete current-claim evidence set together, including searchable text, scanned pages, and photographs. It must:

1. Classify documents by content, not filenames or upload labels.
2. Extract atomic facts with provenance before drawing conclusions.
3. Resolve party roles before extracting names; Applicant, Assured, Insurer, Reinsured/Reassured, Reinsurer, broker, shipper, consignee, carrier, and email sender are distinct roles.
4. Reject headings, addresses, warranties, bill-of-lading boilerplate, endorsements, and OCR fragments from party fields.
5. Read every policy page and separately retain the exact policy or cover-note number, period, insured value, conveyance limits, transit scope, valuation basis or uplift, deductible, clauses, extensions, warranties, conditions, and exclusions.
6. Reconstruct shipment routing chronologically, keeping origin, each sea/air/land leg, transshipment, discharge, final destination, delivery, empty return, vessel/voyage, and transport reference distinct.
7. Separate observed condition, causal indicators, express source-stated cause, and professional causal opinion.
8. Map each material policy term to the relevant established facts without inventing compliance, breach, cover, or legal effect.
9. Keep all financial concepts separate and leave arithmetic to the deterministic application layer.
10. In every analytical section, move from supported facts to interpretation/significance and then to a proportionate professional conclusion.
11. Give the strongest defensible provisional assessment; do not suppress analysis merely because it is not final.
12. Identify counterevidence, alternatives, limitations, and what evidence could change the conclusion.
13. Keep the executive summary concise and reject OCR contamination or irrelevant detail.
14. Return a structured suggestion for human review. Cause, coverage, liability, quantum, recommendations, and conclusions remain reviewable and require professional approval before issue.
15. Extract master and house transport references separately where labelled. Retain source-specific vessel and voyage positions; a conflict between a bill, carrier/tracking record, survey, or other transport source must be stated and must not be converted into an absent transport reference.
16. Classify policy wording by its evidenced function. `Warranted` wording belongs under warranties, procedural or precedent wording under conditions, and `Excluding` wording under exclusions; their possible coverage effect does not permit category mixing.
17. Compare a printed invoice total with an amount-in-words on the same invoice. Any mismatch is a material financial conflict and prevents definitive adequacy, underinsurance, or final-quantum use until reconciled.
18. Return complete professional sentences and remove repeated propositions. Client narrative must not end at a dangling connector, colon, opening parenthesis, `p.`, or `pp.`.
19. Produce client-ready synthesis rather than an extraction dump. Each material section selects the decisive evidence, explains its significance, gives the proportionate professional conclusion, and removes raw OCR, page-reference fragments, repetitive source descriptions, and generic filler while retaining provenance internally.
20. Enforce cross-section consistency. Party roles, transport references and document status, chronology, currency, claim-presentation status, quotation/estimate status, deductible treatment, adjusted amount, cause qualification, cover advice, and liable-party position must retain the same meaning in the summary, detailed sections, adjustment, and conclusion.
21. Make each evidence gap decision-specific by identifying the exact document, test, record, witness, approval, or reconciliation needed and the cause, coverage, quantum, mitigation, liability, recovery, or outcome question it would resolve.
22. Preserve whether a transport record is an original, sea waybill, copy, or draft; reconcile quotation lines, ancillary charges, VAT/tax, and deductible components separately; and keep raw page references in structured provenance rather than client wording.

PDF extraction must not assume that a page with searchable text is visually irrelevant. A searchable page containing a materially sized raster image may also be rendered for Claude vision so that captioned photographs, OCR overlays, logger screens, scans, and mixed text/photo survey pages are not omitted. Additional searchable visual pages are bounded locally; ordinary text pages, logos, and decorative marks must not flood the request. The extracted text remains the verification source for textual facts, while genuinely visual findings use visual provenance.

Before returning the structured result, Claude performs a Director-grade internal review within the same provider request. This review does not expose chain-of-thought and does not create a second paid analysis request. It must:

1. Complete the sourced fact, document, party-role, chronology, policy, quantity, financial, and condition record before assessing the claim.
2. Apply every material test in the applicable owner-approved business-line methodology profile; the profile is an analysis checklist, not merely a writing-style reference.
3. Challenge the draft analysis across chronology and custody, physical condition and extent, proximate cause, policy application, quantum and mitigation, and liability and recovery. Each returned material finding is assigned to one of those analysis domains so the issue ledger remains structured and auditable; `general` is reserved for a material issue that genuinely fits none of them.
4. For each material issue, connect supported facts to professional significance, evidence for and against, viable alternatives, the strongest proportionate provisional assessment, and the exact evidence or decision that could change it.
5. Test causal mechanisms, timing, custody, physical consistency, counterevidence, and alternatives rather than repeating a reported cause or inferring cause from one indicator.
6. Use comparison evidence deliberately: pre-loading against delivery condition, affected against sound items, and differently exposed units or custody periods. Prior similar shipments, routine practice, handling labels, and unaffected comparators are context, not standalone proof of cause or packing compliance.
7. Separate observed damage from inferred internal failure, contamination, hygiene, safety, fitness for purpose, repairability, and total loss. Screening tests support only the proposition established by their evidenced method; stronger technical conclusions require proportionate testing, competent expert or OEM evidence, or explicit qualification and the missing verification.
8. Map each material policy term to the matching current-claim facts and explain the provisional significance without inventing compliance, breach, cover, or legal effect. Keep independently established scope, territory, duration, limit, and exclusion issues separate from disputed cause, packing, warranty, and compliance issues; identify the provisional issue hierarchy while leaving legal effect and approval to the authorized professional.
9. Reconcile the scope of loss at the smallest evidenced unit, preserve every source-stated calculation input, and leave arithmetic to the deterministic application layer.
10. Distinguish every plausible liable or recovery party and test custody, contract, causation, notice, evidence preservation, defences, limitation or time bar, and recovery economics before recommending pursuit.
11. Select the strongest supported outcome branch permitted by the applicable profile, or state which branches remain open and what evidence separates them.
12. Audit the final structured result for unsupported assertions, missed evidence, generic filler, one-sided conflicts, repeated findings, conflated financial concepts, and conclusions that are stronger or weaker than the evidence.
13. Confirm cross-section consistency and client readiness: no summary or conclusion may upgrade a provisional quotation, unresolved conflict, qualified cause, unconfirmed cover position, or unestablished liable party beyond the detailed evidence-led analysis.

Material findings may use a compact analytical paragraph of up to four sentences when needed to connect fact, significance, counterevidence or alternatives, and a proportionate provisional assessment. Concision must not reduce a material issue to a bare observation or generic review warning.

## Final issue quality gate

Draft generation may retain visible review items, but a report cannot be changed to a controlled final issue or exported as final while a mechanical issue blocker remains. Mechanical blockers include a negative reportable indemnity, an adjusted amount without one supported ISO currency, dangling or incomplete client narrative, or warranty wording presented as an exclusion. Final document-control names and approval date must also be complete. Material evidential and professional review items remain subject to the authorized adjuster and approver; the gate does not invent facts or make the coverage decision.

Generated client content must not inherit yellow text highlighting from editing or template placeholders. Table shading, borders, brand colours, and other approved design elements are unaffected.

## No fabrication

- Never fabricate a party, policy term, number, date, route, quantity, amount, cause, coverage position, liability position, document, photograph, citation, or conclusion.
- Claim metadata is context only and is not proof.
- Search the complete current evidence set before marking a value unavailable.
- Unsupported scalar fields are null in AI output, require confirmation, and carry no invented source.
- Client-facing missing values use `Not established from the reviewed evidence` or the approved issue-specific fallback wording.
- Never convert an unknown amount or deduction to zero.
- Never treat a policy limit, sum insured, invoice total, or shipment value as a claim merely because it is monetary.
- Reject OCR garbage and sample-data contamination rather than reproducing it.
- Conflicting evidence stays visible as a conflict and cannot become a definitive Director statement.

## Fact, professional opinion, and uncertainty

### Fact

A fact is expressly supported by uploaded current-claim evidence and has verifiable provenance. Facts may populate the normalized record and client narrative.

### Professional opinion

An opinion is a reasoned inference from cited observations and indicators. It must be phrased as opinion, remain proportionate to its support, and state material alternatives or limitations. It is not converted into a source-stated fact.

### Uncertainty

Use uncertainty language when evidence is absent, contradictory, incomplete, visually ambiguous, or unable to distinguish competing explanations. State:

1. what is established;
2. the strongest supported interpretation;
3. what remains unresolved;
4. why it remains unresolved; and
5. the exact additional evidence or professional determination required.

Do not pad a section with generic uncertainty. Do not use `not established` until the material hypotheses have been tested.

## Previous approved reports

Previous owner-approved reports are style and methodology references only. They may control:

- section order;
- professional tone and level of detail;
- table shapes;
- reasoning method;
- standard non-claim-specific wording.

They must never supply or influence a new claim's parties, policy number, policy wording, shipment details, dates, amounts, findings, photographs, cause, coverage decision, liability conclusion, or adjustment result.

Only explicitly approved JSON style manifests are loaded. Raw historical reports are not automatically loaded. Historical references must never be named, quoted, summarized, or cited in the report. Uploaded current-claim evidence is the only source of claim facts.

Historical regression uses each approved report only as an evaluation target paired with that claim's own source-document bundle. The approved report is never included in the model request or normalized claim evidence. A production rule may change only when a consistent cross-case pattern supports it or when the regression exposes a source-verification, calculation, classification, export, or rendering defect. Claim-specific parties, wording, dates, quantities, amounts, causes, allocations, and outcomes must never be copied into prompts, schemas, templates, code, or reusable style profiles. Legacy examples that conflict with this specification remain recorded regression differences; they do not silently override the current rule.

Legal and technical references may improve professional reasoning only when relevant to the claim, wording, jurisdiction, date, loss type, and established facts. They are never claim evidence and cannot populate facts, amounts, citations, or report content.

## GFS reefer methodology profile

The approved client-scoped profile is named `gfs-reefer`. It is an internal Claude methodology profile, not a source of claim facts and not a separate authentication identity or user-visible AI provider.

The profile activates automatically only when the current claim evidence contains both:

- a supported GFS-family client identifier (`Global Foods Solutions`, `GFS FZCO`, `GFS FZE`, or the supplied `Asteria Trade` family form); and
- refrigerated-cargo context such as reefer, frozen, chilled, or temperature evidence.

If the claim already has a specific business line, it must be `Marine Cargo (Reefer/GFS)`. Unclassified claims may activate the profile from the current evidence so Claude can perform classification. The profile must not be sent to an unrelated client's analysis.

The GFS methodology requires:

1. Concise numbered adjuster/surveyor notes covering instruction, notification, attendance, inspection, joint decisions, mitigation, delivery, and destruction chronologically.
2. Separate treatment of every container, including any original and replacement container and any cross-stuffing event.
3. A temperature review that distinguishes set point, supply air, return air, cargo/probe values, power and alarm events, logger coverage, and data gaps.
4. Correlation of temperature and handling events without assuming that a curve proves the timing or cause of damage.
5. Evidence-supported container and cargo observations, including seal, power, airflow channels, ice, residue, packaging, odour, leakage, discoloration, crystallisation, thawing, contamination, and sample results where material.
6. One evidence-supported outcome branch:
   - sound cargo / no claim;
   - partial loss limited to the established affected quantity; or
   - total loss supported by rejection, health-authority, destruction, or equivalent evidence.
7. Cause testing across refrigeration malfunction, power interruption, temperature variation, stowage/airflow restriction, pre-shipment condition, delay, handling, and material alternatives.
8. Full current-policy review, including the applicable refrigerated-cargo clauses, packing/stowage wording, insured interest, attachment, exclusions, warranties, and who actually packed, stowed, loaded, or instructed loading.
9. Deterministic quantum based on supported affected quantity and invoice rate, plus only evidenced current-claim destination, customs, clearing, delivery, destruction, or other recoverable charges at the source-stated exchange rate.
10. Current-evidence-based carrier, shipper, supplier, consignee, or other recovery analysis. Historical allocation of liability is never reusable.

The global Director wording, section rules, empty Enclosure and Outstanding sections, Appendix limits, calculation controls, citation requirements, and human approval gates override any inconsistent wording or mistake in a historical GFS report.

## Marine Non-Reefer Cargo methodology profile

The approved business-line profile is named `non-reefer-cargo`. It is an internal Claude methodology profile for packaged or containerized non-refrigerated sea-cargo claims, not a source of claim facts and not a separate authentication identity or user-visible AI provider.

The profile activates automatically only when current uploaded evidence contains supported non-refrigerated sea-carriage context, such as a marine policy by sea, a sea-shipment conveyance description, a dry or high-cube container, or open-top containerized cargo. If the claim already has a specific business line, it must be `Marine Cargo (Non-Reefer)`. Unclassified claims may activate the profile from current evidence so Claude can perform classification. The profile must not be sent to refrigerated cargo, loose bulk or breakbulk hold cargo, air, land, property, or other unrelated analysis.

The Marine Non-Reefer methodology requires:

1. A concise appointment and scope statement and a chronological route and custody chain from origin warehouse and stuffing through mother vessel, every transshipment and feeder, discharge, gate-out, inland delivery, door opening, unloading and empty return.
2. Resolution of the applicant, insurer, policyholder, Assured, seller, shipper, consignee, buyer, notify party, forwarder, contracting and actual carrier, carrier agent, terminal, stevedore, haulier, warehouse, customs interest, surveyor, supplier, repairer, salvage buyer and destruction contractor before responsibility is discussed.
3. Separate treatment of every bill of lading, booking, tracking record, container, seal, delivery order, proof of delivery, equipment interchange receipt, gate and customs record. Scheduled routing, actual movement and cargo condition must remain distinct.
4. Separate treatment of each container by number, type, size, packages, weight, cargo allocation and outcome, including standard dry, high-cube, open-top, flat-rack and supported over-height or out-of-gauge conditions.
5. Evidence-led packing, stowage and lashing analysis based on who controlled the work, cargo fragility, dimensions and weight, crates, cartons, pallets, wrapping, cushioning, void filling, blocking, bracing, straps, distribution, clearances, handling instructions and the ordinary rigours of the supported voyage.
6. Evidence-led impact, crushing and breakage analysis testing pre-loading condition, damage geometry and distribution, affected versus intact packages, container marks, cargo position, crane or spreader clearance, shifting, contact points, transshipment and unloading. Breakage alone does not prove hard impact or rough handling.
7. Evidence-led wetting, rust and contamination analysis inspecting the container and distinguishing puncture or structural defect, seawater, freshwater or rain, condensation or sweat, pre-shipment moisture, cleaning residue and post-delivery exposure.
8. Proper treatment of field tests. Silver-nitrate, chloride, salinity, moisture and comparable tests are screening evidence unless the current record establishes sampling, custody, equipment, reagents, controls, results and limitations; a positive result does not by itself prove timing, entry route or responsible custody.
9. Chronological treatment of notification, appointment, carrier notice, reserve, survey invitation, attendance or abstention, signed statement of facts, segregation, mitigation, repair, salvage and destruction. Carrier abstention is not an admission of liability.
10. Damage reconciliation at the smallest supported level and separation of initial allegations, consignee lists, survey counts, statements, invoices and final segregation. Total loss requires supported unfitness, repair economics, residual utility and salvage, rejection or destruction evidence.
11. For machinery and component claims, a like-for-like comparison of cleaning, testing, repair, replacement parts and complete replacement, including technical feasibility, expert or OEM requirements, labour, freight, installation, commissioning, hygiene or safety, useful life, betterment and residual value.
12. Full current-policy review, including the actual Institute Cargo Clauses, transit duration, customs-storage period, clean-document and preliminary-survey warranties, packing and under-deck conditions, container and replacement clauses, classification requirements, shortage certificates, deductibles, valuation, limits and relevant rust, moisture, scratching, denting, delay or other exclusions.
13. Deterministic line-by-line quantum from supported quantities and rates, with supported freight allocation, exchange rate and date, uplift, deductible, salvage, depreciation and recovery in the correct order. Quotations, unlawful payments, unsupported penalties, arbitrary recovery percentages and historical arithmetic are not reusable adjustment inputs.
14. Current-evidence recovery analysis distinguishing every candidate and testing transport terms, custody, receipt condition, reservations, notice, survey invitation, causation, equipment condition, limitation, jurisdiction, time bar, security, evidence preservation and recovery economics.
15. Selection of the supported outcome branch: no established loss, partial breakage or damage, repairable machinery or component loss, evidenced total loss, wetting or contamination, shortage or non-delivery, packing or handling-related loss, an excluded or warranty-affected claim, or a covered loss below the deductible.
16. Current-claim photographs only, prioritising material loading, packing, stowage, lashing, container, roof or door defects, seals, delivery condition, affected and sound comparisons, testing, segregation, repair, salvage and destruction under the global Appendix limits.
17. Role-complete summary presentation. When the Assured and shipper differ, show both with their exact roles rather than replacing one with the other. Preserve separately evidenced master- and house-bill parties where the current documents establish those distinctions.
18. Explicit transport-document status and conflict treatment. Identify an original, sea waybill or draft as shown by the current document, compare master and house bills with carrier tracking, retain vessel, voyage, party, date and route conflicts, and request final documents instead of silently selecting a version.
19. Provisional quotation treatment that reconciles each replacement or repair line, ancillary charge and VAT or tax separately, keeps recoverability open where unresolved, and applies any percentage/minimum/maximum deductible only as a clearly labelled provisional calculation. A quotation alone does not establish a presented claim or concluded indemnity.
20. Concise breakage reasoning that moves from observed condition to compatible mechanisms, viable packing/pre-shipment/port/sea/inland/unloading alternatives, and the exact transport, stuffing, delivery, survey, notice, crate-design and lashing evidence needed to strengthen the conclusion. Raw OCR and truncated photo-page references are not client narrative.

The global Director wording, approved section order, empty Enclosure and Outstanding sections, Appendix limits, no-fabrication rules, deterministic calculations, citation requirements, and human approval gates override every unsupported cause or liability statement, unreconciled quantity, screening-test overstatement, arbitrary recovery deduction, line-item arithmetic error, conclusion order, or legacy appendix practice in a historical Non-Reefer report.

## Bulk Vessels methodology profile

The approved business-line profile is named `bulk-vessels`. It is an internal Claude methodology profile for bulk-vessel and breakbulk cargo claims, not a source of claim facts and not a separate authentication identity or user-visible AI provider.

The profile activates automatically only when current claim evidence contains supported bulk-vessel or breakbulk context, such as a bulk carrier, bulk cargo, cargo hold, hatch cover, draft survey, bagged cargo, or equivalent terminology. If the claim already has a specific business line, it must be `Bulk Vessel`. Unclassified claims may activate the profile from current evidence so Claude can perform classification. The profile must not be sent to containerized, reefer, property, or other unrelated analysis.

The Bulk Vessels methodology requires:

1. A concise appointment and scope statement followed by a chronological account of origin loading, voyage events, arrival, hatch opening, discharge, daily tallies, notices, segregation, warehouse inspection, mitigation, salvage, and disposal where supported.
2. Resolution of every material party and role, including seller, shipper, buyer, Assured, consignee, assignee, applicant, broker, carrier, owner, charterer, stevedore, P&I interest, survey company, and attending surveyor.
3. Separate treatment of each bill of lading, hold, commodity, brand, package size, survey stage, condition category, and responsible custody period. Loose bulk and bagged or packaged breakbulk cargo must not be analysed as the same carriage mode.
4. Cross-checking of current transport, policy, vessel, origin-quality, survey, tally, testing, notice, mitigation, and financial evidence. A clean bill, certificate, internal vessel record, or historical inspection is not conclusive by itself.
5. Evidence-led testing of the material causal branches: seawater ingress and hatch-cover integrity; heavy weather; ventilation and condensation; inherent vice, mould, heating, caking, or infestation; stevedore handling and rain exposure; shortage or theft; fire, heat, smoke, soot, and firefighting contamination; stowage and packing; and material alternatives.
6. Proper treatment of field and laboratory testing. Record the sampling method, sample identity and custody, location, date, participants, equipment or calibration, measured result, and limitations; distinguish screening tests from conclusive laboratory evidence.
7. Reconciliation of manifested, loaded, discharged, delivered, sound, affected, torn, empty, mouldy, short, reconditioned, salvaged, destroyed, and retained quantities without double counting. Initial allegations, daily tallies, joint surveys, and final segregation must remain distinct where they differ.
8. Deterministic quantum from current-evidence quantities, weights, invoice rates, supported depreciation or total-loss treatment, policy uplift, freight and charges, salvage, and the correct deductible basis. Historical rates, percentages, allocations, or arithmetic are never reusable.
9. Full current-policy review, including the actual transit duration, loading and unloading cover, port-to-port or warehouse extension, Institute Cargo Clauses, shortage and wetting provisions, valuation, deductible, exclusions, survey warranties, hold-cleanliness or tightness requirements, clean-document requirements, vessel class, and P&I conditions.
10. Current-evidence recovery analysis distinguishing carrier, owner, charterer, stevedore, terminal, shipper, supplier, survey company, and other candidates. Bills and reverse terms, charterparty, agency, notices, LOP, LOI, LOU or security, causation, limitation, preservation, and recovery economics must be tested before recommending pursuit.
11. Selection of the supported outcome branch: no established loss, partial loss, total loss, or an otherwise covered loss falling below the applicable deductible. No historical outcome may control the current claim.
12. Current-claim photographs only, prioritising material cargo, hold, hatch, testing, handling, segregation, warehouse, mitigation, salvage, and disposal views under the global Appendix limits.

The global Director wording, approved section order, empty Enclosure and Outstanding sections, Appendix limits, no-fabrication rules, deterministic calculations, citation requirements, and human approval gates override every inconsistent wording, conclusion order, arithmetic error, or legacy appendix practice in a historical Bulk Vessels report.

## Air Shipments methodology profile

The approved business-line profile is named `air-shipments`. It is an internal Claude methodology profile for air-cargo and air-parcel claims, not a source of claim facts and not a separate authentication identity or user-visible AI provider.

The profile activates automatically only when current uploaded evidence contains supported air-carriage context, such as an air waybill, master or house AWB, air freight, air cargo, airport routing, or Institute Cargo Clauses (Air). If the claim already has a specific business line, it must be `Air Shipment (NET)`. Unclassified claims may activate the profile from current evidence so Claude can perform classification. The profile must not be sent to sea-cargo, bulk-vessel, property, or other unrelated analysis.

The Air Shipments methodology requires:

1. A concise appointment and scope statement and a chronological route and custody chain from collection and origin warehouse through acceptance, airports, actual flights and transshipment hubs, customs or regulatory holds, storage, final-mile delivery, return, or non-delivery.
2. Resolution of the applicant, insurer, policyholder, Assured, seller, shipper, master- and house-waybill consignees, ultimate receiver, freight forwarder, issuing agent, contracting and successive carriers, ground handler, customs broker, warehouse, and trucking or final-mile provider.
3. Separate treatment of every master air waybill, house air waybill, forwarder waybill, parcel tracking record, manifest, delivery record, and carrier condition. Scheduled movement must not be reported as actual movement without current evidence.
4. Separate treatment of invoice value, insured value, policy and shipment limits, carriage or customs declarations, freight, presented claim, and carrier recovery limit. A transport declaration is not automatically the policy value or indemnity.
5. Evidence-led testing of the material causal branches: impact or rough handling; stacking or compression; inadequate packing; temperature excursion, dry-ice depletion, or re-icing failure; delay, customs, or storage handling; partial delivery or shortage; and loss or non-delivery.
6. Professional-packing analysis based on who packed, actual outer and inner materials, fragility, weight, ordinary route rigours, handling instructions, pre-loading and delivery evidence, expert requirements, and causal significance. Missing packing photographs prove neither compliance nor breach.
7. Temperature analysis that distinguishes required set point from measured product or logger temperature and records logger identity, time zone, interval, calibration or validation, coverage, excursion start and duration, maximum and minimum, custody correlation, and any gap before delivery. A temperature excursion does not by itself establish spoilage or total loss.
8. Non-delivery analysis based on the scan-by-scan chain, last supported custodian and location, clearance or storage issues, tracing and investigation status, scheduled return, carrier acknowledgment, and notice. An unlocated shipment must not be labelled theft without supporting current evidence.
9. Full current-policy and endorsement review, including the applicable Institute Cargo Clauses (Air), warehouse-to-warehouse duration, territorial and commodity scope, excluded countries, storage limits, airport or warehouse survey requirements, packing, clean-waybill and data-logger conditions, declaration requirements, valuation, shipment limit, and deductible. Sea clauses and unrelated exclusion clause numbers must not be substituted for air cover.
10. Deterministic reconciliation of shipped, delivered, damaged, missing, rejected, and claimed quantities and calculation from supported invoice values, freight or charges, uplift, exchange rate, deductible, salvage, and recoveries. Conflicting quantities, values, dates, and currencies remain visible for human review.
11. Current-evidence recovery analysis distinguishing carrier, successive carrier, forwarder, handler, broker, warehouse, final-mile provider, and shipper or packer. Waybill and reverse terms, custody, complaint timing, package weight, declared value, limitation, causation, preservation, and recovery economics must be tested before pursuit is recommended.
12. Selection of the supported outcome branch: no established loss, partial or repairable damage, evidenced total loss, temperature-related loss, non-delivery, an excluded or warranty-affected claim, or a covered loss below the deductible.
13. Current-claim photographs only, prioritising material external and internal packing, labels, handling marks, pallets, damage, logger displays, delivery condition, and recovered items under the global Appendix limits. A reference photograph of an undamaged item is not evidence of the shipped package's condition.

The global Director wording, approved section order, empty Enclosure and Outstanding sections, Appendix limits, no-fabrication rules, deterministic calculations, citation requirements, and human approval gates override every inconsistent clause number, unsupported liability allocation, arithmetic error, conclusion order, or legacy appendix practice in a historical Air Shipment report.

## Land Shipments methodology profile

The approved business-line profile is named `land-shipments`. It is an internal Claude methodology profile for road and land-transit cargo claims, not a source of claim facts and not a separate authentication identity or user-visible AI provider.

The profile activates automatically only when current uploaded evidence contains supported land-carriage context, such as land or road transit, road freight, a truck waybill, a CMR or international consignment note, or an express mode of conveyance by land. If the claim already has a specific business line, it must be `Land Shipment`. Unclassified claims may activate the profile from current evidence so Claude can perform classification. The profile must not be sent to air, sea, bulk-vessel, property, or other unrelated analysis.

The Land Shipments methodology requires:

1. A concise appointment and scope statement followed by a chronological route and custody chain from origin warehouse and loading through every truck, trailer, driver, handover, border, customs inspection, waiting or storage location, transloading, seal change, delivery and unloading event that current evidence supports.
2. Resolution of the applicant, insurer, policyholder, Assured, seller, consignor or shipper, consignee or receiver, buyer, freight forwarder, contracting and successive carrier, subcontracted haulier, driver, vehicle and trailer owner, customs broker, border or customs authority, warehouse, cold-chain provider and survey interests before responsibility is discussed.
3. Separate treatment of every CMR or international consignment note, truck waybill, dispatch record, customs or border form, delivery note, proof of delivery, gate, GPS and carrier record. Planned routing and actual movement must remain distinct.
4. A complete vehicle, trailer, driver, seal and access history where material, including origin sealing, customs or border openings, resealing, forced entry or tampering, unattended stops, accidents, breakdowns, delays, police or carrier investigation and the last supported custody point.
5. Evidence-led shortage, theft and non-delivery analysis reconciling dispatched, loaded, counted, delivered, damaged, missing and claimed quantities and identifying who performed or witnessed each count. An intact seal is material but does not by itself prove origin short-loading or exclude other access.
6. Evidence-led physical-damage analysis testing pre-loading condition, packing, pallets, stacking, lashing, load distribution, vehicle suitability, accident or impact, weather, water entry, customs handling, unloading, delivery reservations, segregation, mitigation and salvage. Damage on arrival alone does not prove rough handling.
7. Refrigerated-road analysis that separates required range, set point, reefer readings, product readings and every logger's actual record and correlates excursions with custody, borders, door opening, power or fuel, breakdown, storage and delivery. Excursion alone does not establish deterioration or total loss.
8. Full current-policy review, including the evidenced land-transit clause, warehouse-to-warehouse duration, territorial and route limits, vehicle and carrier conditions, unattended-vehicle or forcible-entry theft wording, packing and lashing warranty, temperature conditions, survey requirement, customs and storage provisions, war or strikes exclusions on land, declarations, valuation, limit and deductible.
9. Deterministic reconciliation of current-evidence quantities, rates, insured and invoice values, freight or charges, uplift, exchange rate, deductible, salvage, depreciation and recovery. Shipment value, policy limit, transport invoice or debit note is not automatically the adjusted loss.
10. Current-evidence recovery analysis distinguishing the contracting carrier, successive or subcontracted haulier, driver, forwarder, warehouse, customs or border custodian, shipper and packer. CMR or carriage terms, custody, notice, investigation, causation, limitation, evidence preservation, time bar and recovery economics must be tested before pursuit is recommended.
11. Selection of the supported outcome branch: no established loss, partial shortage, proven or qualified theft, partial or repairable damage, evidenced total loss, temperature-related loss, non-delivery, an excluded or warranty-affected claim, or a covered loss below the deductible.
12. Current-claim photographs only, prioritising material loading, packing, pallets, vehicle or trailer, registrations, seals, border or customs handling, logger, damage, unloading, segregation, salvage and disposal views under the global Appendix limits.

The global Director wording, approved section order, empty Enclosure and Outstanding sections, Appendix limits, no-fabrication rules, deterministic calculations, citation requirements, and human approval gates override every unsupported theft allegation, custody allocation, policy conclusion, arithmetic error, conclusion order, or legacy appendix practice in a historical Land Shipment report.

## Photograph selection and Appendix A

- Use photographs of the current claim only.
- Prefer material views supporting condition, damage, packaging, identification markings, containers, seals, handling, or other claim-relevant visual findings.
- Prefer AI-selected evidence-supported pages; if none are selected, the renderer may use available appendix image pages in source order.
- Remove exact duplicate images and duplicate document/page selections.
- Include no more than four photographs on one A4 page.
- Include no more than three photograph pages.
- The hard maximum is 12 photographs.
- Preserve image aspect ratio and fit each image inside its allocated grid cell.
- Appendix A uses the heading `Appendix A - Photographs`.
- Use one brief sentence describing what the photographs show. The current standard sentence is:

  > Photographs reproduce material views available in the current claim file, including the insured interest, packaging, identification markings, and observed condition where shown.

- Do not print document filenames, evidence IDs, per-photo labels such as `Photograph 1`, or document lists in Appendix A.
- Do not fabricate photographs or repeat a photograph to reach a target count.
- When no photographs are available, the export may state that no photographs were provided; it must not invent placeholders.

## Citation and evidence rules

Every non-null AI field, substantive document-type classification, business-line classification, evidence finding, and adjustment line must carry source provenance:

- exact uploaded `document_id` and `document_name`;
- page number when known, otherwise null;
- one short contiguous supporting excerpt copied verbatim;
- confidence from 0 through 1;
- evidence mode: `extracted_text`, `document_vision`, or `image_vision`.

Use `extracted_text` only when the excerpt can be verified in extracted text. Use a vision mode only for a genuinely visual fact not established by extracted text.

The server verifies source identities and extracted excerpts. Invalid citation indexes are discarded. Unsupported fields, findings, and adjustment rows are withheld. Claude citations may be repaired only by matching the claimed excerpt to the actual uploaded document text; they are not repaired from historical or legal references.

A business-line classification whose direct citation cannot be verified may be retained only when a separately verified, sufficient, line-specific transport document establishes the same mode: an Air Waybill for `Air Shipment (NET)`, a Truck Waybill for `Land Shipment`, or a Bill of Lading for `Marine Cargo (Non-Reefer)`. The retained confidence is capped at the lower of Claude's classification confidence and the verified document-type confidence. This recovery does not apply to conflicting classifications or to business lines lacking the specified independent support; those cases remain `Other / Requires Review`. Application mapping accepts confidence represented as either a normalized 0-through-1 value or an already-percent 0-through-100 value and displays one bounded percentage.

Both sides of a material conflict require supporting provenance. Do not silently choose one source.

Internal provenance belongs in the normalized claim record and review interface. The issued master DOCX intentionally omits inline `[Source: ...]` labels and internal review diagnostics from the client narrative.

## Human control

AI output is a draft suggestion. Professional review and approval are always required before issue. Coverage, cause, liability, recovery, quantum, recommendations, and conclusions remain explicitly reviewable. The report must not present an unsupported automated result as a final professional determination.

## Known implementation mismatches

These mismatches exist in the current code and are documented here; this file does not change them:

1. `src/lib/reportTemplates.js` still stores the metadata title `Outstanding/ Not Available Documents`, while the issued DOCX and its tests use the approved title `Outstanding Documents`.
2. The issued DOCX leaves `Enclosure to this report` and `Outstanding Documents` empty, but the Markdown draft/preview path currently falls back to a `Not established from the reviewed evidence` bullet for an empty list.
3. `MIN_REPORT_PHOTOGRAPHS` is declared as 3, but the current selection/export path does not enforce a minimum; it may export fewer than three or no photographs when sufficient current-claim images are unavailable.
4. The legacy file `samples/templates/REPORTING-SPEC.md` says photographs require printed evidence IDs, captions, dates, and source references. The current approved DOCX intentionally prints only the one-sentence Appendix description and the photographs; provenance remains internal.

Do not resolve any listed mismatch as part of unrelated work. A behavior change requires explicit approval, corresponding production changes, and updated tests and specification.
