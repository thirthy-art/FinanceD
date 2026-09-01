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
    const body = { name: "Unknown Extraction Vendor", taxId: "CY-AUTO-100", creationSource: "ai_extraction" };
    const first = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body));
    const second = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body));
    const firstJson = await first.json() as { id: number; vendorStatus: string };
    const secondJson = await second.json() as { id: number; vendorStatus: string; reused: boolean };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(firstJson.vendorStatus).toBe("draft");
    expect(secondJson).toMatchObject({ id: firstJson.id, vendorStatus: "draft", reused: true });
    const matches = await db.select().from(schema.vendors).where(and(
      eq(schema.vendors.companyId, companyA),
      eq(schema.vendors.normalizedTaxId, "CYAUTO100"),
    ));
    expect(matches).toHaveLength(1);
    expect(matches[0].vendorStatus).toBe("draft");
  });

  it.skipIf(!HAS_DB)("keeps manually created vendors active", async () => {
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Manual Active Vendor",
      taxId: "CY-MANUAL-200",
    }));
    const vendor = await response.json() as { id: number; vendorStatus: string };

    expect(response.status).toBe(201);
    expect(vendor.vendorStatus).toBe("active");
    expect((await db.select().from(schema.vendors).where(eq(schema.vendors.id, vendor.id)))[0].vendorStatus).toBe("active");
  });

  it.skipIf(!HAS_DB)("reuses an existing active vendor by normalized Tax ID", async () => {
    const existingResponse = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Existing Active Tax Vendor",
      taxId: "CY-ACTIVE-300",
    }));
    const existing = await existingResponse.json() as { id: number };
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Different Extracted Name",
      taxId: " cy active 300 ",
      creationSource: "ai_extraction",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: existing.id, vendorStatus: "active", reused: true });
  });

  it.skipIf(!HAS_DB)("reuses an existing draft vendor by normalized Tax ID", async () => {
    const firstResponse = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Existing Draft Tax Vendor",
      taxId: "CY-DRAFT-400",
      creationSource: "ai_extraction",
    }));
    const first = await firstResponse.json() as { id: number };
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Different Draft Extracted Name",
      taxId: "cy draft 400",
      creationSource: "ai_extraction",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: first.id, vendorStatus: "draft", reused: true });
  });

  it.skipIf(!HAS_DB)("reuses an existing draft vendor by normalized exact name", async () => {
    const firstResponse = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Draft Name Match Vendor",
      creationSource: "ai_extraction",
    }));
    const first = await firstResponse.json() as { id: number };
    const response = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "  draft   name match vendor  ",
      creationSource: "ai_extraction",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: first.id, vendorStatus: "draft", reused: true });
  });

  it.skipIf(!HAS_DB)("reuses the resulting draft vendor after a concurrent Tax ID conflict", async () => {
    const body = {
      name: "Concurrent AI Vendor",
      taxId: "CY-CONCURRENT-600",
      creationSource: "ai_extraction",
    };
    const responses = await Promise.all([
      createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body)),
      createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, body)),
    ]);
    const vendors = await Promise.all(responses.map((response) => response.json() as Promise<{ id: number; vendorStatus: string }>));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(vendors[0].id).toBe(vendors[1].id);
    expect(vendors.every((vendor) => vendor.vendorStatus === "draft")).toBe(true);
    expect(await db.select().from(schema.vendors).where(and(
      eq(schema.vendors.companyId, companyA),
      eq(schema.vendors.normalizedTaxId, "CYCONCURRENT600"),
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
      creationSource: "ai_extraction",
    }));
    const companyAVendor = await response.json() as { id: number; vendorStatus: string };

    expect(response.status).toBe(201);
    expect(companyAVendor.id).not.toBe(companyBVendor.id);
    expect(companyAVendor.vendorStatus).toBe("draft");
    expect((await db.select().from(schema.vendors).where(eq(schema.vendors.id, companyAVendor.id)))[0].companyId).toBe(companyA);
  });

  it.skipIf(!HAS_DB)("approves an invoice with the real vendorId returned by automatic creation", async () => {
    const vendorResponse = await createVendor(companyRequest("http://localhost/api/settings/vendors", companyA, {
      name: "Approval Flow Supplier",
      taxId: "CY-APPROVE-700",
      creationSource: "ai_extraction",
    }));
    const vendor = await vendorResponse.json() as { id: number; vendorStatus: string };
    expect(vendor.vendorStatus).toBe("draft");
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
    expect((await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, invoice.id)))[0]).toMatchObject({
      vendorId: vendor.id,
      status: "approved",
    });
  });
});
