/**
 * DB-level integration tests for the supplier invoice schema and data integrity.
 *
 * These tests require a PostgreSQL connection (DATABASE_URL from .env).
 * They are explicitly skipped when no database is available.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { calculateBaseAmount } from "../lib/invoice-validation";

const HAS_DB = !!process.env.DATABASE_URL;

// ── DB setup ─────────────────────────────────────────────────────────────────

let pool: Pool;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("SELECT 1");
  db = drizzle(pool, { schema });
});

afterAll(async () => {
  if (pool) await pool.end();
});

afterEach(async () => {
  if (!HAS_DB) return;
  for (const id of createdInvoiceIds) {
    await db.delete(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, id));
  }
  createdInvoiceIds.length = 0;
});

async function getCompanyId(): Promise<number> {
  const rows = await db.select().from(schema.companies).limit(1);
  if (rows.length) return rows[0].id;
  const [company] = await db
    .insert(schema.companies)
    .values({ name: "Test Company", baseCurrency: "EUR" })
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
      currency: "EUR",
      currencyType: "fiat",
      fxRateToBase: "1",
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

// ── Draft save ────────────────────────────────────────────────────────────────

describe("draft save", () => {
  it.skipIf(!HAS_DB)("creates an invoice in draft status", async () => {
    const inv = await createDraftInvoice();
    expect(inv.status).toBe("draft");
    expect(inv.invoiceNumber).toBe("TEST-001");
  });

  it.skipIf(!HAS_DB)("allows saving a draft with mismatched amounts", async () => {
    const inv = await createDraftInvoice({
      netAmount: "100.00",
      vatAmount: "20.00",
      grossAmount: "999.00",
    });
    expect(inv.status).toBe("draft");
    expect(inv.grossAmount).toBe("999.000000000000000000");
  });

  it.skipIf(!HAS_DB)("updates invoice fields on subsequent save", async () => {
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

// ── Approval ──────────────────────────────────────────────────────────────────

describe("approval", () => {
  it.skipIf(!HAS_DB)("approves an invoice when amounts are consistent", async () => {
    const inv = await createDraftInvoice();
    const [approved] = await db
      .update(schema.supplierInvoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id))
      .returning();
    expect(approved.status).toBe("approved");
  });

  it.skipIf(!HAS_DB)("approved invoice retains its data", async () => {
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
  });

  it.skipIf(!HAS_DB)("approved invoice remains approved after valid edit", async () => {
    const inv = await createDraftInvoice();
    await db
      .update(schema.supplierInvoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id));
    const [edited] = await db
      .update(schema.supplierInvoices)
      .set({ notes: "Updated note", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id))
      .returning();
    expect(edited.status).toBe("approved");
  });
});

// ── Decimal precision ─────────────────────────────────────────────────────────

describe("decimal precision in DB", () => {
  it.skipIf(!HAS_DB)("0.000000000000000001 survives persistence unchanged", async () => {
    const tiny = "0.000000000000000001";
    const inv = await createDraftInvoice({
      netAmount: tiny,
      vatAmount: "0",
      grossAmount: tiny,
      currencyType: "crypto",
    });
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.netAmount).toBe("0.000000000000000001");
    expect(fetched.grossAmount).toBe("0.000000000000000001");
  });

  it.skipIf(!HAS_DB)("value with >15 significant digits is not corrupted", async () => {
    const precise = "12345678901234567.123456789012345678";
    const inv = await createDraftInvoice({
      netAmount: precise,
      vatAmount: "0",
      grossAmount: precise,
      currencyType: "crypto",
    });
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.netAmount).toBe(precise);
  });

  it.skipIf(!HAS_DB)("FX rate with 18 decimals survives persistence", async () => {
    const rate = "0.000034567890123456";
    const inv = await createDraftInvoice({ fxRateToBase: rate });
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.fxRateToBase).toBe("0.000034567890123456");
  });

  it.skipIf(!HAS_DB)("base amounts store 4 decimal places", async () => {
    const inv = await createDraftInvoice({
      baseNetAmount: "1234.5678",
      baseVatAmount: "246.9136",
      baseGrossAmount: "1481.4814",
    });
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.baseNetAmount).toBe("1234.5678");
    expect(fetched.baseVatAmount).toBe("246.9136");
    expect(fetched.baseGrossAmount).toBe("1481.4814");
  });
});

// ── FX rate independence ──────────────────────────────────────────────────────

describe("FX rate independence", () => {
  it.skipIf(!HAS_DB)("two invoices on same date can have different rates", async () => {
    const inv1 = await createDraftInvoice({
      invoiceDate: "2024-06-15",
      currency: "USD",
      fxRateToBase: "0.92",
      netAmount: "1000",
    });
    const inv2 = await createDraftInvoice({
      invoiceDate: "2024-06-15",
      currency: "USD",
      fxRateToBase: "0.93",
      netAmount: "1000",
    });
    const [f1] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv1.id));
    const [f2] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv2.id));
    expect(f1.fxRateToBase).not.toBe(f2.fxRateToBase);
  });

  it.skipIf(!HAS_DB)("changing FX rate does not change original amounts", async () => {
    const inv = await createDraftInvoice({
      netAmount: "1000.50",
      fxRateToBase: "1.2",
    });
    await db
      .update(schema.supplierInvoices)
      .set({
        fxRateToBase: "1.5",
        baseNetAmount: calculateBaseAmount("1000.50", "1.5"),
        updatedAt: new Date(),
      })
      .where(eq(schema.supplierInvoices.id, inv.id));
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.netAmount).toBe("1000.500000000000000000");
    expect(fetched.fxRateToBase).toBe("1.500000000000000000");
    expect(fetched.baseNetAmount).toBe("1500.7500");
  });

  it.skipIf(!HAS_DB)("approved invoice stays approved after FX rate edit", async () => {
    const inv = await createDraftInvoice();
    await db
      .update(schema.supplierInvoices)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.supplierInvoices.id, inv.id));
    await db
      .update(schema.supplierInvoices)
      .set({
        fxRateToBase: "1.25",
        baseNetAmount: calculateBaseAmount("1000.00", "1.25"),
        baseVatAmount: calculateBaseAmount("200.00", "1.25"),
        baseGrossAmount: calculateBaseAmount("1200.00", "1.25"),
        updatedAt: new Date(),
      })
      .where(eq(schema.supplierInvoices.id, inv.id));
    const [fetched] = await db
      .select()
      .from(schema.supplierInvoices)
      .where(eq(schema.supplierInvoices.id, inv.id));
    expect(fetched.status).toBe("approved");
  });
});

// ── Document immutability ─────────────────────────────────────────────────────

describe("document immutability", () => {
  it.skipIf(!HAS_DB)("document table has no updatedAt column", async () => {
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
    expect(doc.originalFilename).toBe("original.pdf");
    expect("updatedAt" in doc).toBe(false);
    await db
      .delete(schema.supplierInvoiceDocuments)
      .where(eq(schema.supplierInvoiceDocuments.invoiceId, inv.id));
  });
});
