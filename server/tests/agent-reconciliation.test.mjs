import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDossier } from "../ai/agent/reconciliationEngine.mjs";

test("reconcileDossier flags missing mandatory documents and container mismatch", () => {
  const indexedDocuments = {
    "inv.pdf": {
      name: "inv.pdf",
      document_type: "Commercial Invoice",
      extracted_fields: { container_number: "MSKU9988771", invoice_total: "120000" }
    },
    "survey.pdf": {
      name: "survey.pdf",
      document_type: "Survey Report",
      extracted_fields: { container_number: "MSKU1122334", seal_condition: "Intact" }
    }
  };

  const recon = reconcileDossier({
    business_line: "Marine Cargo (Reefer/GFS)",
    documents: indexedDocuments
  });

  assert.equal(recon.container_numbers.length, 2);
  assert.equal(recon.has_bill_of_lading, false);
  assert.ok(recon.missing_mandatory_docs.includes("Bill of Lading"));
  assert.ok(recon.discrepancies.some((d) => d.includes("Multiple distinct container numbers")));
  assert.equal(recon.reconciliation_score < 1.0, true);
});

test("reconcileDossier scores 1.0 when all mandatory documents are present without conflict", () => {
  const indexedDocuments = {
    "bol.pdf": { name: "bol.pdf", document_type: "Bill of Lading", extracted_fields: { container_number: "MSKU100" } },
    "inv.pdf": { name: "inv.pdf", document_type: "Commercial Invoice", extracted_fields: { container_number: "MSKU100" } },
    "sur.pdf": { name: "sur.pdf", document_type: "Survey Report", extracted_fields: { container_number: "MSKU100" } },
    "temp.pdf": { name: "temp.pdf", document_type: "Temperature Records", extracted_fields: { container_number: "MSKU100" } },
  };

  const recon = reconcileDossier({
    business_line: "Marine Cargo (Reefer/GFS)",
    documents: indexedDocuments
  });

  assert.equal(recon.missing_mandatory_docs.length, 0);
  assert.equal(recon.discrepancies.length, 0);
  assert.equal(recon.reconciliation_score, 1.0);
});
