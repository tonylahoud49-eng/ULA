import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuantumAndUnderinsurance } from "../ai/agent/quantumEngine.mjs";

test("calculateQuantumAndUnderinsurance computes exact REPORT_SPEC.md formulas", () => {
  const lineItems = [
    { description: "Damaged Frozen Tuna (1,000 kg)", quantity: 1000, unit_price: 25.00, total: 25000 },
    { description: "Haulage to Cold Store", quantity: 1, unit_price: 1500.00, total: 1500 },
  ];

  const result = calculateQuantumAndUnderinsurance({
    lineItems,
    invoiceTotal: 100000,
    insuredValue: 110000,
    upliftPercentage: 10, // required: 100000 * 1.10 = 110000
    currency: "USD",
    deductions: { salvage: 3000, depreciation: 1000 },
    deductibleConfig: { type: "fixed", amount: 2500 },
  });

  assert.equal(result.gross_loss, 26500);
  assert.equal(result.total_deductions, 4000);
  assert.equal(result.net_before_deductible, 22500);
  assert.equal(result.is_underinsured, false);
  assert.equal(result.underinsurance_amount, 0);
  assert.equal(result.deductible_applied, 2500);
  assert.equal(result.net_indemnity, 20000);
  assert.ok(result.adequacy_statement.includes("adequately insured and there is no underinsurance"));
});

test("calculateQuantumAndUnderinsurance detects underinsurance with 0.01 tolerance", () => {
  const result = calculateQuantumAndUnderinsurance({
    lineItems: [{ description: "Cargo loss", total: 50000 }],
    invoiceTotal: 100000,
    insuredValue: 90000,
    upliftPercentage: 10, // required: 110000. Underinsurance = 20000.
    currency: "EUR",
    deductions: {},
    deductibleConfig: { type: "percentage", percentage: 10, minimum: 1000, maximum: 10000 },
  });

  assert.equal(result.is_underinsured, true);
  assert.equal(result.underinsurance_amount, 20000);
  assert.ok(result.adequacy_statement.includes("not adequately insured"));
  assert.ok(result.adequacy_statement.includes("EUR 20,000.00"));
});
