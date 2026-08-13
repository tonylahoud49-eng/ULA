import fs from "node:fs/promises";
import path from "node:path";

const base = path.resolve("samples/test-evidence");

await fs.mkdir(path.join(base, "air-cargo"), { recursive: true });
await fs.mkdir(path.join(base, "property-damage"), { recursive: true });
await fs.mkdir(path.join(base, "fidelity"), { recursive: true });

// Air Cargo Pack
await fs.writeFile(path.join(base, "air-cargo", "01_Air_Waybill_AWB-774-9821.txt"), 
`AIR WAYBILL / LETTRE DE TRANSPORT AERIEN
AWB Number: 774-9821-4402
Airport of Departure: Frankfurt Airport (FRA), Germany
Airport of Destination: Beirut Rafic Hariri International Airport (BEY), Lebanon
Shipper: BioTech Precision Instruments GmbH, Frankfurt, Germany
Consignee: Levant Medical Supplies SAL, Beirut, Lebanon
Carrier: SkyFreight Cargo Airlines (Flight SF-802)
Handling Info: TEMPERATURE CONTROLLED (+2C to +8C). CRITICAL MEDICAL SENSORS.
Commodity: 4 Crates Temperature-Sensitive Diagnostic Analyzers
Gross Weight: 340.0 kg | Declared Value for Carriage: USD 118,500.00
Flight Date: 12 March 2026
Condition at Destination: Cargo arrived with broken seals and external shock sensor triggered.`);

await fs.writeFile(path.join(base, "air-cargo", "02_Commercial_Invoice_INV-2026-991.txt"),
`COMMERCIAL INVOICE
Invoice No: INV-2026-991 | Date: 08 March 2026
Seller: BioTech Precision Instruments GmbH, Siemensstrasse 14, Frankfurt, Germany
Buyer: Levant Medical Supplies SAL, Hamra Street, Beirut, Lebanon
Terms: CIP Beirut Airport (Incoterms 2020)
--------------------------------------------------------------------------------
Item | Description | Qty | Unit Price (USD) | Total (USD)
1    | Precision Analyzer Core Unit Mod-X4  | 2  | 38,000.00 | 76,000.00
2    | Optical Calibration Module Sens-9    | 2  | 14,500.00 | 29,000.00
3    | Reagent Sensor Interface Arrays      | 4  | 3,375.00  | 13,500.00
--------------------------------------------------------------------------------
Total Commercial Value: USD 118,500.00
Payment Terms: Confirmed Irrevocable Letter of Credit
Insurer Notified: Lia Assurex SAL`);

await fs.writeFile(path.join(base, "air-cargo", "03_Preliminary_Survey_Report.txt"),
`UNITED LOSS ADJUSTERS & SURVEYORS (ULA)
PRELIMINARY ATTENDANCE & SURVEY REPORT
Date of Attendance: 14 March 2026
Surveyor: Petro Zaarour, Chartered Marine Surveyor & Loss Adjuster
Location: Cargo Handling Facility, Beirut Airport Freight Terminal
Subject: Inspection of 4 wooden crates containing diagnostic analyzers ex Flight SF-802

FINDINGS:
1. Physical shock indicators on Crates #2 and #3 were activated (red latch tripped > 25G impact).
2. Internal casing on Analyzer Unit #2 showed hairline fracture across laser optic mounting.
3. Cold chain temperature data logger recorded temperature excursion to +28.4C for 6 hours due to delayed tarmac transfer.
4. Technical calibration testing indicates Unit #2 is beyond economical repair (Total Loss).
5. Unit #1 and Sensor Arrays #3-#4 tested compliant and operational after recalibration.

RECOMMENDED QUANTUM ADJUSTMENT:
- Total Loss Unit #2: USD 38,000.00
- Recalibration & Inspection Cost: USD 4,200.00
- Less Agreed Policy Deductible: (USD 2,500.00)
- Net Concluded Payable Quantum: USD 39,700.00`);

// Property Damage Pack
await fs.writeFile(path.join(base, "property-damage", "01_Commercial_Property_Policy.txt"),
`COMMERCIAL ALL RISKS PROPERTY INSURANCE POLICY
Policy No: PROP-UK-884920-2026
Insurer: Apex Underwriting Syndicate 1844 at Lloyd's
Insured: Victoria Retail & Distribution Hub Ltd
Premises: Unit 4-7 Riverside Industrial Park, London E16 2QX
Period of Cover: 01 Jan 2026 to 31 Dec 2026
Sum Insured (Buildings): GBP 4,200,000.00
Sum Insured (Stock & Machinery): GBP 1,850,000.00
Deductible: GBP 10,000.00 each and every loss
Operative Clauses: All Risks of physical loss or damage, including Burst Water Mains, Accidental Discharge of Fire Suppression, and Storm.`);

await fs.writeFile(path.join(base, "property-damage", "02_Loss_Adjuster_Inspection_Schedule.txt"),
`LOSS ADJUSTER ATTENDANCE & CAUSE OF LOSS REPORT
Surveying Firm: United Loss Adjusters & Surveyors Ltd (ULA)
Surveyor Attended: Annie Abdel Massih, Chartered Engineer
Date of Loss: 24 February 2026 | Date of Attendance: 25 February 2026
Incident: Water ingress and ceiling collapse following overhead main freeze/rupture.

INVESTIGATION SUMMARY:
Inspection of warehouse bay 3 revealed catastrophic rupture of 4-inch main distribution riser on mezzanine floor. Escaping water accumulated on suspended acoustic ceiling causing partial collapse over finished goods storage.

DAMAGES NOTED:
1. Suspended ceiling grid and insulation tiles: 180 sqm destroyed.
2. Palletized packaging stock (Grade A retail cartons): 450 units water-soaked.
3. Electrical sub-distribution board Bay 3: Short-circuited and contaminated.

ADJUSTMENT SUMMARY:
- Building Repair Quotation (Apex Contractors Ltd): GBP 34,200.00
- Damaged Stock (Cost Price basis): GBP 28,400.00
- Electrical Rewiring & Testing: GBP 8,900.00
- Total Claimed: GBP 71,500.00
- Less Policy Deductible: (GBP 10,000.00)
- Net Concluded Adjusted Amount: GBP 61,500.00`);

// Fidelity Pack
await fs.writeFile(path.join(base, "fidelity", "01_Fidelity_Guarantee_Policy.txt"),
`COMMERCIAL FIDELITY GUARANTEE POLICY
Policy Number: FID-2026-004812
Insurer: Global Indemnity Underwriters Ltd
Insured: Apex Capital Asset Management SAL
Cover: Direct financial loss sustained through fraudulent acts or embezzlement committed by employees in the course of employment.
Limit of Indemnity: USD 500,000.00 any one claim and in the annual aggregate.
Deductible: USD 15,000.00
Discovery Period: 12 months following termination of employment.`);

await fs.writeFile(path.join(base, "fidelity", "02_Internal_Audit_Investigation_Findings.txt"),
`SPECIAL INVESTIGATION & FORENSIC AUDIT REPORT
Conducted by: United Loss Adjusters & Surveyors Forensic Claims Unit
Subject: Unauthorized Supplier Invoices & Diverted Remittances

INVESTIGATION SUMMARY:
Detailed ledger reconciliation between 01 May 2025 and 15 January 2026 identified 14 fictitious vendor invoices approved under dual-authorization bypass.
Funds were transferred to offshore accounts controlled by former senior accounting administrator.

FINANCIAL QUANTUM:
- Total Verified Misappropriation: USD 164,800.00
- Recovered Funds via Frozen Bank Account: (USD 42,000.00)
- Net Insured Loss: USD 122,800.00
- Less Applicable Deductible: (USD 15,000.00)
- Net Adjusted Claim Liability: USD 107,800.00`);

console.log("Successfully created test evidence documents in samples/test-evidence/");
