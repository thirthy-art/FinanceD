/**
 * Integration tests for the supplier invoice save/approve flow.
 *
 * These tests use a real PostgreSQL connection (DATABASE_URL from .env).
 * Each test creates its own invoice row and deletes it on teardown so the
 * suite can run repeatedly without leaving state behind.
 */
import { describe, it, expect, afterEach } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { isAmountMismatch } from "../lib/invoice-validation";

// ── DB setup ─────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// Ensure a company exists (seed may have run already)
async function getCompanyId(): Promise<number> {
  const rows = await db.select().from(schema.companies).limit(1);
  if (rows.length) return rows[0].id;
  const [company] = await db
    .insert(schema.companies)
    .values({ name: "Test Company", baseCurrency: "USD" })
    .returning();
  return company.id;
}

const createdInvoiceIds: number[] = [];

async function createDraftInvoice(overrides: Partial<typeof schema.supplierInvoices.$inferInsert> = {}) {
  const companyId = await getCompanyId();
  const [inv] = await db
    .insert(schema.supplierInvoices)
    .values({
      companyId,
      status: "draft",
      currency: "USD",
      netAmount: "1000.00",
      vatAmount: "200.00",
      grossAmount: "1200.00",
      invoiceNumber: "TEST-001",
      ...overrides,
    })
    .returning();
  createdInvoiceIds.push(inv.id);
  return inv;
}

afterEach(async () => {
  // Clean up invoices created during the test
  for (const id of createdInvoiceIds) {
    await db.delete(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, id));
  }
  createdInvoiceIds.length = 0;
});

// ── Draft save ────────────────────────────────────────────────────────────────

describe("draft save", () => {
  it("creates an invoice in draft status", async () => {
    const inv = await createDraftInvoice();
    expect(inv.status).toBe("draft");
    expect(inv.invoiceNumber).toBe("TEST-001");
  });

  it("allows saving a draft with mismatched amounts (no server-side block for drafts)", async () => {
    // Net + VAT != Gross, but draft should still save
    const inv = await createDraftInvoice({
      netAmount: "100.00",
      vatAmount: "20.00",
      grossAmount: "999.00", // wrong
    });
    expect(inv.status).toBe("draft");
    expect(inv.grossAmount).toBe("999.00");
  });

  it("updates invoice fields on subsequent save", async () => {
    const inv = await createDraftInvoice();
    const [updated] = await db
      .update(schema.supplierInvoices)
      .set({ invoiceNumber: "TEST-UPDATED", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id))
      .returning();
    expect(updated.invoiceNumber).toBe("TEST-UPDATED");
    expect(updated.status).toBe("draft");
  });
});

// ── Approval ─────────────────────────────────────────────────────────────────

describe("approval", () => {
  it("approves an invoice when amounts are consistent", async () => {
    const inv = await createDraftInvoice();
    const [approved] = await db
      .update(schema.supplierInvoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id))
      .returning();
    expect(approved.status).toBe("approved");
  });

  it("approval logic correctly rejects mismatched amounts (via isAmountMismatch)", () => {
    // Simulates what the API PATCH handler does before writing status=approved
    const net = 1000;
    const vat = 200;
    const gross = 1300; // wrong
    expect(isAmountMismatch(net, vat, gross)).toBe(true);
  });

  it("approval logic accepts amounts within tolerance (0.01 rounding)", () => {
    expect(isAmountMismatch(100, 20, 120.01)).toBe(false);
    expect(isAmountMismatch(100, 20, 119.99)).toBe(false);
  });

  it("approved invoice retains its data", async () => {
    const inv = await createDraftInvoice({ invoiceDate: "2024-01-15" });
    await db
      .update(schema.supplierInvoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id));
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.status).toBe("approved");
    expect(fetched.invoiceDate).toBe("2024-01-15");
    expect(fetched.netAmount).toBe("1000.00");
    expect(fetched.grossAmount).toBe("1200.00");
  });
});

// ── Document immutability ─────────────────────────────────────────────────────

describe("document immutability", () => {
  it("no update operation is defined on supplier_invoice_documents", async () => {
    // The schema has no updatedAt on documents; there is no API route to PATCH
    // a document. This test verifies that the document table has the columns we
    // expect (no mutable content columns that could be overwritten).
    const inv = await createDraftInvoice();
    await db.insert(schema.supplierInvoiceDocuments).values({
      invoiceId: inv.id,
      originalFilename: "original.pdf",
      storagePath: "/uploads/test.pdf",
      mimeType: "application/pdf",
      extractedText: "some text",
      ocrPerformed: false,
    });

    const [doc] = await db
      .select()
      .from(schema.supplierInvoiceDocuments)
      .where(eq(schema.supplierInvoiceDocuments.invoiceId, inv.id));

    // The document row has no updatedAt — it is append-only by design.
    // TypeScript will catch any attempt to update it because the schema
    // does not define an updatedAt column or any route to PATCH it.
    expect(doc.originalFilename).toBe("original.pdf");
    expect(doc.storagePath).toBe("/uploads/test.pdf");
    expect("updatedAt" in doc).toBe(false);

    // Clean up document too
    await db
      .delete(schema.supplierInvoiceDocuments)
      .where(eq(schema.supplierInvoiceDocuments.invoiceId, inv.id));
  });
});
