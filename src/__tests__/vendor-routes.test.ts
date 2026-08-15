import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/src/db/schema";

const HAS_DB = Boolean(process.env.DATABASE_URL);
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let DELETE_VENDOR: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let MERGE_VENDOR: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const invoiceIds: number[] = [];
const vendorIds: number[] = [];

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
  DELETE_VENDOR = (await import("@/app/api/settings/vendors/[id]/route")).DELETE as unknown as typeof DELETE_VENDOR;
  MERGE_VENDOR = (await import("@/app/api/settings/vendors/[id]/merge/route")).POST as unknown as typeof MERGE_VENDOR;
});

afterEach(async () => {
  if (!HAS_DB) return;
  for (const id of invoiceIds) await db.delete(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, id));
  invoiceIds.length = 0;
  for (const id of vendorIds) await db.delete(schema.vendors).where(eq(schema.vendors.id, id));
  vendorIds.length = 0;
});
afterAll(async () => { if (pool) await pool.end(); });

async function companyId() {
  const [existing] = await db.select({ id: schema.companies.id }).from(schema.companies).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.companies).values({ name: "Vendor Route Test" }).returning({ id: schema.companies.id });
  return created.id;
}

async function vendor(name: string, taxId: string | null = null) {
  const [created] = await db.insert(schema.vendors).values({ companyId: await companyId(), name, taxId }).returning();
  vendorIds.push(created.id);
  return created;
}

function context(id: number) { return { params: Promise.resolve({ id: String(id) }) }; }

describe("vendor deletion and merge", () => {
  it.skipIf(!HAS_DB)("allows deletion only when the vendor has zero invoice references", async () => {
    const unreferenced = await vendor(`Unreferenced ${Date.now()}`);
    expect((await DELETE_VENDOR(new Request("http://localhost", { method: "DELETE" }), context(unreferenced.id))).status).toBe(200);
    expect(await db.select().from(schema.vendors).where(eq(schema.vendors.id, unreferenced.id))).toHaveLength(0);
    vendorIds.splice(vendorIds.indexOf(unreferenced.id), 1);

    const referenced = await vendor(`Referenced ${Date.now()}`);
    const [invoice] = await db.insert(schema.supplierInvoices).values({ companyId: referenced.companyId, vendorId: referenced.id }).returning();
    invoiceIds.push(invoice.id);
    const response = await DELETE_VENDOR(new Request("http://localhost", { method: "DELETE" }), context(referenced.id));
    expect(response.status).toBe(409);
    expect((await response.json()).invoiceCount).toBe(1);
  });

  it.skipIf(!HAS_DB)("moves invoice references to the target before deleting the source", async () => {
    const source = await vendor(`Merge Source ${Date.now()}`, "CY-MERGE-1");
    const target = await vendor(`Merge Target ${Date.now()}`);
    const [invoice] = await db.insert(schema.supplierInvoices).values({ companyId: source.companyId, vendorId: source.id }).returning();
    invoiceIds.push(invoice.id);

    const response = await MERGE_VENDOR(new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetVendorId: target.id }),
    }), context(source.id));
    expect(response.status).toBe(200);
    expect((await db.select().from(schema.supplierInvoices).where(eq(schema.supplierInvoices.id, invoice.id)))[0].vendorId).toBe(target.id);
    expect(await db.select().from(schema.vendors).where(eq(schema.vendors.id, source.id))).toHaveLength(0);
    vendorIds.splice(vendorIds.indexOf(source.id), 1);
  });
});
