import test from "node:test";
import assert from "node:assert/strict";
import { indexDocumentWithReader } from "../ai/agent/documentReaderAgent.mjs";
import { computeFileHash } from "../ai/agent/dossierStore.mjs";

test("indexDocumentWithReader reuses cached extraction when hash matches", async () => {
  const mockFile = {
    originalname: "Commercial_Invoice.pdf",
    buffer: Buffer.from("Invoice #INV-2026-001\nTotal Amount: USD 52,000.00\nShipper: Global Exports"),
    mimetype: "application/pdf"
  };

  const currentHash = computeFileHash(mockFile.buffer);

  const cached = {
    hash: currentHash,
    document_type: "Commercial Invoice",
    extracted_fields: { invoice_number: "INV-2026-001", invoice_total: "52000" },
    line_items: [{ description: "Goods", amount: 52000 }],
    salient_facts: ["Invoice verified"]
  };

  const result = await indexDocumentWithReader({
    file: mockFile,
    cachedDoc: cached,
    claimContext: { business_line: "Marine Cargo" }
  });

  assert.equal(result.from_cache, true);
  assert.equal(result.document_type, "Commercial Invoice");
  assert.equal(result.extracted_fields.invoice_number, "INV-2026-001");
});

test("indexDocumentWithReader extracts fallback metadata when provider is offline", async () => {
  const mockFile = {
    originalname: "Bill_of_Lading.txt",
    buffer: Buffer.from("Bill of Lading #BL-9988\nShipper: Alpha Co\nConsignee: Omega LLC"),
    mimetype: "text/plain"
  };

  const result = await indexDocumentWithReader({
    file: mockFile,
    cachedDoc: null,
    claimContext: { business_line: "Marine Cargo" },
    providerName: "mock-offline",
  });

  assert.equal(result.from_cache, false);
  assert.equal(result.name, "Bill_of_Lading.txt");
  assert.ok(result.hash);
});
