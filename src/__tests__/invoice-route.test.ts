/**
 * Route-level integration tests for the supplier invoice PATCH handler.
 *
 * These tests invoke the actual PATCH handler from app/api/invoices/[id]/route.ts
 * against a real PostgreSQL database. They are explicitly skipped (not silently
 * returned) when no database connection is available.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

// ── Dynamic import of route handler ──────────────────────────────────────────
// We import the PATCH handler and call it directly with a NextRequest,
// which exercises the full route code path including Zod parsing, validation,
// DB reads/writes, and JSON response construction.

let PATCH: (req: unknown, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let DELETE: (req: unknown, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const HAS_DB = !!process.env.DATABASE_URL;

// ── DB setup ─────────────────────────────────────────────────────────────────

let pool: Pool;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("SELECT 1");
  db = drizzle(pool, { schema });

  const mod = await import("@/app/api/invoices/[id]/route");
  PATCH = mod.PATCH as typeof PATCH;
  DELETE = mod.DELETE as typeof DELETE;
});

afterAll(async () => {
  if (pool) await pool.end();
});

const createdInvoiceIds: number[] = [];
const createdVendorIds: number[] = [];

afterEach(async () => {
  if (!HAS_DB) return;
  for (const id of createdInvoiceIds) {
    await db.delete(schema.supplierInvoiceLines).where(eq(schema.supplierInvoiceLines.invoiceId, id));
    await db.delete(schema.supplierInvoiceDocuments).where(eq(schema.supplierInvoiceDocuments.invoiceId, id));
    await db.delete(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, id));
  }
  createdInvoiceIds.length = 0;
  for (const id of createdVendorIds) {
    await db.delete(schema.vendors).where(eq(schema.vendors.id, id));
  }
  createdVendorIds.length = 0;
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

async function createTestInvoice(overrides: Partial<typeof schema.supplierInvoices.$inferInsert> = {}) {
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
      invoiceDate: "2024-01-15",
      ...overrides,
    })
    .returning();
  createdInvoiceIds.push(inv.id);
  return inv;
}

async function createTestVendor(): Promise<number> {
  const companyId = await getCompanyId();
  const [v] = await db
    .insert(schema.vendors)
    .values({ companyId, name: "Test Vendor" })
    .returning();
  createdVendorIds.push(v.id);
  return v.id;
}

async function attachDocument(invoiceId: number) {
  await db.insert(schema.supplierInvoiceDocuments).values({
    invoiceId,
    originalFilename: "test.pdf",
    storagePath: "/uploads/test.pdf",
    mimeType: "application/pdf",
    extractedText: "test",
    ocrPerformed: false,
  });
}

function patchRequest(invoiceId: number, body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/invoices/[id] — route-level", () => {
  it.skipIf(!HAS_DB)("editing an approved invoice preserves Approved status", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({ status: "approved", vendorId });
    await attachDocument(inv.id);

    const res = await PATCH(
      patchRequest(inv.id, { notes: "Updated note" }),
      params(inv.id)
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("approved");
    expect(json.notes).toBe("Updated note");
  });

  it.skipIf(!HAS_DB)("invalid edit to an approved invoice is rejected", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({ status: "approved", vendorId });
    await attachDocument(inv.id);

    // Try to null out a required field on an approved invoice
    const res = await PATCH(
      patchRequest(inv.id, { invoiceNumber: null }),
      params(inv.id)
    );

    // Since we're saving (no status change) and the invoice is approved,
    // the server validates the final state and rejects missing required fields
    expect(res.status).toBe(422);
  });

  it.skipIf(!HAS_DB)("accidental approved→draft downgrade is blocked", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({ status: "approved", vendorId });
    await attachDocument(inv.id);

    const res = await PATCH(
      patchRequest(inv.id, { status: "draft" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/[Cc]annot downgrade/);
  });

  it.skipIf(!HAS_DB)("foreign invoice with missing rate cannot be approved", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({
      currency: "USD",
      fxRateToBase: null,
      vendorId,
    });
    await attachDocument(inv.id);

    const res = await PATCH(
      patchRequest(inv.id, { status: "approved" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/FX rate/);
  });

  it.skipIf(!HAS_DB)("foreign invoice with zero rate cannot be approved", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({
      currency: "USD",
      fxRateToBase: null,
      vendorId,
    });
    await attachDocument(inv.id);

    const res = await PATCH(
      patchRequest(inv.id, { status: "approved", fxRateToBase: "0" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
  });

  it.skipIf(!HAS_DB)("same-currency invoice auto-sets rate to 1", async () => {
    const inv = await createTestInvoice({
      currency: "EUR",
      fxRateToBase: null,
    });

    const res = await PATCH(
      patchRequest(inv.id, { netAmount: "500" }),
      params(inv.id)
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fxRateToBase).toBe("1.000000000000000000");
  });

  it.skipIf(!HAS_DB)("two same-date invoices may use different rates", async () => {
    const inv1 = await createTestInvoice({
      currency: "USD",
      fxRateToBase: "0.92",
      invoiceDate: "2024-06-15",
    });
    const inv2 = await createTestInvoice({
      currency: "USD",
      fxRateToBase: "0.93",
      invoiceDate: "2024-06-15",
    });

    const [f1] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv1.id));
    const [f2] = await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv2.id));
    expect(f1.fxRateToBase).not.toBe(f2.fxRateToBase);
  });

  it.skipIf(!HAS_DB)("changing rate recalculates only base amounts", async () => {
    const inv = await createTestInvoice({
      currency: "USD",
      fxRateToBase: "1.2",
      netAmount: "1000.50",
      vatAmount: "200.00",
      grossAmount: "1200.50",
    });

    const res = await PATCH(
      patchRequest(inv.id, { fxRateToBase: "1.5" }),
      params(inv.id)
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    // Original amounts unchanged
    expect(json.netAmount).toBe("1000.500000000000000000");
    // Base recalculated
    expect(json.baseNetAmount).toBe("1500.7500");
    expect(json.baseVatAmount).toBe("300.0000");
    expect(json.baseGrossAmount).toBe("1800.7500");
  });

  it.skipIf(!HAS_DB)("invalid decimal text returns 422", async () => {
    const inv = await createTestInvoice();

    const res = await PATCH(
      patchRequest(inv.id, { netAmount: "abc" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it.skipIf(!HAS_DB)("European decimal normalization works through route", async () => {
    const inv = await createTestInvoice();

    const res = await PATCH(
      patchRequest(inv.id, { netAmount: "1.234,56", vatAmount: "0", grossAmount: "1.234,56" }),
      params(inv.id)
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.netAmount).toBe("1234.560000000000000000");
  });

  it.skipIf(!HAS_DB)("empty invoice cannot be approved", async () => {
    const companyId = await getCompanyId();
    const [inv] = await db
      .insert(schema.supplierInvoices)
      .values({
        companyId,
        status: "draft",
        currency: "EUR",
        currencyType: "fiat",
      })
      .returning();
    createdInvoiceIds.push(inv.id);

    const res = await PATCH(
      patchRequest(inv.id, { status: "approved" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/[Cc]annot approve/);
  });

  it.skipIf(!HAS_DB)("failed validation does not create a vendor", async () => {
    const inv = await createTestInvoice();

    const vendorCountBefore = await db.select({ id: schema.vendors.id }).from(schema.vendors);

    // Try to approve with a new vendor name but invalid amounts
    const res = await PATCH(
      patchRequest(inv.id, {
        newVendorName: "Should Not Exist",
        netAmount: "abc",
        status: "approved",
      }),
      params(inv.id)
    );

    expect(res.status).toBe(422);

    const vendorCountAfter = await db.select({ id: schema.vendors.id }).from(schema.vendors);
    expect(vendorCountAfter.length).toBe(vendorCountBefore.length);
  });

  it.skipIf(!HAS_DB)("saving an approved invoice without status field preserves approved", async () => {
    const vendorId = await createTestVendor();
    const inv = await createTestInvoice({ status: "approved", vendorId });
    await attachDocument(inv.id);

    // Omit status entirely — simulates "Save Changes" on approved invoice
    const res = await PATCH(
      patchRequest(inv.id, { notes: "minor edit" }),
      params(inv.id)
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("approved");
  });

  it.skipIf(!HAS_DB)("NaN-like value is rejected with 422", async () => {
    const inv = await createTestInvoice();

    const res = await PATCH(
      patchRequest(inv.id, { fxRateToBase: "NaN" }),
      params(inv.id)
    );

    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/invoices/[id] — draft-only", () => {
  it.skipIf(!HAS_DB)("deletes a draft invoice and its lines", async () => {
    const inv = await createTestInvoice();
    await db.insert(schema.supplierInvoiceLines).values({
      invoiceId: inv.id,
      position: 0,
      description: "Test line",
      netAmount: "1000.00",
    });

    const res = await DELETE(new Request(`http://localhost/api/invoices/${inv.id}`, { method: "DELETE" }), params(inv.id));
    expect(res.status).toBe(200);
    expect(await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv.id))).toHaveLength(0);
    expect(await db.select().from(schema.supplierInvoiceLines).where(eq(schema.supplierInvoiceLines.invoiceId, inv.id))).toHaveLength(0);
  });

  it.skipIf(!HAS_DB)("refuses to hard-delete an approved invoice", async () => {
    const inv = await createTestInvoice({ status: "approved" });
    const res = await DELETE(new Request(`http://localhost/api/invoices/${inv.id}`, { method: "DELETE" }), params(inv.id));

    expect(res.status).toBe(409);
    expect(await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, inv.id))).toHaveLength(1);
  });
});
