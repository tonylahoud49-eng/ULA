/**
 * Strict REPORT_SPEC.md Deterministic Math Engine
 * Rule: required insured value = invoice total × (1 + evidenced uplift percentage / 100)
 * Rule: underinsurance = required insured value - documented insured value
 * Rule: tolerance 0.01
 */
export function calculateQuantumAndUnderinsurance({
  lineItems = [],
  invoiceTotal = null,
  insuredValue = null,
  upliftPercentage = 0,
  currency = "USD",
  deductions = {},
  deductibleConfig = {},
}) {
  const gross = lineItems.reduce((sum, item) => {
    const val = Number(item.total ?? item.adjusted_value ?? (Number(item.quantity || 0) * Number(item.unit_price || 0))) || 0;
    return sum + val;
  }, 0);

  const salvage = Number(deductions.salvage || 0);
  const depreciation = Number(deductions.depreciation || 0);
  const totalDeductions = salvage + depreciation;
  const netBeforePolicy = Math.max(0, gross - totalDeductions);

  // Adequacy & Underinsurance check per REPORT_SPEC.md lines 157-185
  let adequacyStatement = "";
  let isUnderinsured = false;
  let underinsuranceAmount = 0;
  let requiredInsuredValue = null;

  const invNum = Number(invoiceTotal);
  const insNum = Number(insuredValue);
  const hasComparableInputs = Number.isFinite(invNum) && invNum > 0 && Number.isFinite(insNum) && insNum > 0 && currency;

  if (hasComparableInputs) {
    const upliftRate = Number(upliftPercentage || 0) / 100;
    requiredInsuredValue = Number((invNum * (1 + upliftRate)).toFixed(2));
    const diff = Number((requiredInsuredValue - insNum).toFixed(2));

    if (insNum + 0.01 >= requiredInsuredValue) {
      isUnderinsured = false;
      underinsuranceAmount = 0;
      adequacyStatement = `The invoice values are adequately insured and there is no underinsurance on the evidenced valuation basis (${upliftPercentage}% uplift).`;
    } else {
      isUnderinsured = true;
      underinsuranceAmount = diff;
      const formattedDiff = diff.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      adequacyStatement = `The invoice values are not adequately insured; the calculated underinsurance difference is ${currency} ${formattedDiff} on the evidenced valuation basis.`;
    }
  } else {
    adequacyStatement = "Whether the invoice values are adequately insured and whether there is underinsurance requires a comparable invoice value, insured value, currency, and evidenced valuation basis; obtain the missing comparable input before giving that opinion.";
  }

  // Deductible formula parsing per REPORT_SPEC.md line 205
  let deductibleApplied = 0;
  if (deductibleConfig.type === "fixed") {
    deductibleApplied = Number(deductibleConfig.amount || 0);
  } else if (deductibleConfig.type === "percentage") {
    const pct = Number(deductibleConfig.percentage || 0) / 100;
    let computed = netBeforePolicy * pct;
    if (deductibleConfig.minimum && computed < Number(deductibleConfig.minimum)) {
      computed = Number(deductibleConfig.minimum);
    }
    if (deductibleConfig.maximum && computed > Number(deductibleConfig.maximum)) {
      computed = Number(deductibleConfig.maximum);
    }
    deductibleApplied = computed;
  } else if (typeof deductibleConfig === "number") {
    deductibleApplied = deductibleConfig;
  }

  // Underinsurance factor application (average condition) if underinsured
  const factor = (isUnderinsured && requiredInsuredValue && requiredInsuredValue > 0)
    ? Math.min(1.0, insNum / requiredInsuredValue)
    : 1.0;

  const adjustedLoss = netBeforePolicy * factor;
  const netIndemnity = Math.max(0, adjustedLoss - deductibleApplied);

  return {
    currency,
    gross_loss: Number(gross.toFixed(2)),
    total_deductions: Number(totalDeductions.toFixed(2)),
    salvage_deduction: salvage,
    depreciation_deduction: depreciation,
    net_before_deductible: Number(netBeforePolicy.toFixed(2)),
    underinsurance_factor: Number(factor.toFixed(4)),
    is_underinsured: isUnderinsured,
    underinsurance_amount: underinsuranceAmount,
    adequacy_statement: adequacyStatement,
    deductible_applied: Number(deductibleApplied.toFixed(2)),
    net_indemnity: Number(netIndemnity.toFixed(2)),
  };
}
