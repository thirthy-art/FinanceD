import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/src/db/schema";

const HAS_DB = Boolean(process.env.DATABASE_URL);
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let createVendor: (request: Request) => Promise<Response>;
let patchInvoice: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let companyA: number;
let companyB: number;
const invoiceIds: number[] = [];

function companyRequest(url: string, companyId: number, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `financed_company_id=${companyId}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
  createVendor = (await import("@/app/api/settings/vendors/route")).POST as unknown as typeof createVendor;
  patchInvoice = (await import("@/app/api/invoices/[id]/route")).PATCH as unknown as typeof patchInvoice;
  const stamp = `${Date.now()}-${Math.random()}`;
  const created = await db.insert(schema.companies).values([
    { name: `Vendor resolution A ${stamp}`, baseCurrency: "EUR" },
    { name: `Vendor resolution B ${stamp}`, baseCurrency: "EUR" },
  ]).returning({ id: schema.companies.id });
  companyA = created[0].id;
  companyB = created[1].id;
});

afterAll(async () => {
  if (!HAS_DB) return;
  if (invoiceIds.length) {
    await db.delete(schema.supplierInvoiceDocuments).where(inArray(schema.supplierInvoiceDocuments.invoiceId, invoiceIds));
    await db.delete(schema.supplierInvoices).where(inArray(schema.supplierInvoices.id, invoiceIds));
  }
  await db.delete(schema.vendors).where(inArray(schema.vendors.companyId, [companyA, companyB]));
  await db.delete(schema.companies).where(inArray(schema.companies.id, [companyA, companyB]));
  await pool.end();
});

describe("POST /api/settings/vendors invoice resolution", () => {
  it.skipIf(!HAS_DB)("creates one draft vendor for an unknown identity and reuses it on retry", async () => {
    const body = { name: "Unknown Extraction Vendor", taxId: "CY-AUTO-100" };
    const first = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body));
    const second = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body));
    const firstJson = await first.json() as { id: number };
    const secondJson = await second.json() as { id: number; reused: boolean };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondJson).toMatchObject({ id: firstJson.id, reused: true });
    expect(await db.select().from(schema.vendors).where(and(
      eq(schema.vendors.companyId, companyA),
      eq(schema.vendors.normalizedTaxId, "CYAUTO100"),
    ))).toHaveLength(1);
  });

  it.skipIf(!HAS_DB)("does not create or guess when normalized exact-name matching is ambiguous", async () => {
    await db.insert(schema.vendors).values([
      { companyId: companyA, name: "Ambiguous Supplier" },
      { companyId: companyA, name: "  ambiguous   supplier  " },
    ]);
    const before = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyA));
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "ambiguous supplier",
    }));
    const body = await response.json() as { candidates: Array<{ id: number }>; matchedOn: string };
    const after = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyA));

    expect(response.status).toBe(409);
    expect(body.matchedOn).toBe("name");
    expect(body.candidates).toHaveLength(2);
    expect(after).toHaveLength(before.length);
  });

  it.skipIf(!HAS_DB)("keeps identity matching and creation inside the active company", async () => {
    const taxId = "CY-ISOLATED-500";
    const [companyBVendor] = await db.insert(schema.vendors).values({
      companyId: companyB,
      name: "Company B Supplier",
      taxId,
      normalizedTaxId: "CYISOLATED500",
    }).returning();
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Company A Supplier",
      taxId,
    }));
    const companyAVendor = await response.json() as { id: number };

    expect(response.status).toBe(201);
    expect(companyAVendor.id).not.toBe(companyBVendor.id);
    expect((await db.select().from(schema.vendors).where(eq(schema.vendors.id, companyAVendor.id)))[0].companyId).toBe(companyA);
  });

  it.skipIf(!HAS_DB)("approves an invoice with the real vendorId returned by automatic creation", async () => {
    const vendorResponse = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Approval Flow Supplier",
      taxId: "CY-APPROVE-700",
    }));
    const vendor = await vendorResponse.json() as { id: number };
    const [invoice] = await db.insert(schema.supplierInvoices).values({
      companyId: companyA,
      invoiceNumber: "AUTO-APPROVE-1",
      invoiceDate: "2026-09-01",
      currency: "EUR",
      currencyType: "fiat",
      fxRateToBase: "1",
      netAmount: "100",
      vatAmount: "20",
      grossAmount: "120",
    }).returning();
    invoiceIds.push(invoice.id);
    await db.insert(schema.supplierInvoiceDocuments).values({
      invoiceId: invoice.id,
      originalFilename: "auto-approve.pdf",
      storagePath: "/uploads/auto-approve.pdf",
      mimeType: "application/pdf",
      ocrPerformed: false,
    });

    const response = await patchInvoice(new Request(`http://localhost/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `financed_company_id=${companyA}`,
      },
      body: JSON.stringify({ vendorId: vendor.id, status: "approved" }),
    }), { params: Promise.resolve({ id: String(invoice.id) }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ vendorId: vendor.id, status: "approved" });
  });
});
