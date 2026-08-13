import fs from "node:fs/promises";
import path from "node:path";

const base = path.resolve("samples/test-evidence/air-cargo");

await fs.writeFile(
  path.join(base, "04_Marine_Air_Transit_Policy_POL-2026-8812.txt"),
`OPEN CARGO & AIR TRANSIT INSURANCE POLICY
Policy Number: POL-AIR-2026-8812
Insurer: Lia Assurex SAL, Beirut, Lebanon
Broker: Aon Middle East Insurance Brokers Ltd
Assured / Insured: Levant Medical Supplies SAL
Period of Insurance: 01 January 2026 to 31 December 2026
Conveyance / Limits: Any one Air Shipment up to USD 250,000.00
Coverage Terms: Institute Cargo Clauses (Air), Institute War Clauses (Air Cargo), Institute Strikes Clauses (Air Cargo).
Deductible / Excess: USD 2,500.00 each and every loss.
Conditions: Including temperature excursion coverage (+2C to +8C) subject to logger verification.`
);

await fs.writeFile(
  path.join(base, "03_Packing_List_PL-2026-991.csv"),
`Item,Package Mark,Description,Net Weight (kg),Gross Weight (kg),Dimensions (cm)
1,Crate 1/4,Precision Analyzer Core Unit Mod-X4 (SN: X4-9081),75.0,85.0,90x80x75
2,Crate 2/4,Precision Analyzer Core Unit Mod-X4 (SN: X4-9082),75.0,85.0,90x80x75
3,Crate 3/4,Optical Calibration Module Sens-9 (SN: S9-112),60.0,70.0,75x65x60
4,Crate 4/4,Reagent Sensor Interface Arrays (4 Units),90.0,100.0,100x85x70
Total,4 Wooden Crates,,300.0,340.0,`
);

await fs.writeFile(
  path.join(base, "05_Notice_of_Claim_Form.txt"),
`NOTICE OF CARGO CLAIM & CLAIM DECLARATION FORM
Claimant / Consignee: Levant Medical Supplies SAL
Carrier: SkyFreight Cargo Airlines (Flight SF-802 ex Frankfurt)
Air Waybill: 774-9821-4402
Date of Loss / Flight Arrival: 12 March 2026
Policy Reference: POL-AIR-2026-8812 (Lia Assurex SAL)
Nature of Loss: Severe physical impact shock and tarmac temperature excursion damaging Precision Analyzer Unit #2 during transit.
Claimed Amount: USD 39,700.00 (Total Loss of Unit #2 + Technical Calibration less deductible)
Declaration: We hereby give formal notice of claim against the carrier and under our transit policy.`
);

console.log("Successfully created complete Air Cargo evidence pack");
