import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "dotenv/config";
import ExcelJS from "exceljs";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/src/db/schema";

const identity = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string } }));
vi.mock("@/src/lib/current-user", () => ({
  getAuthenticatedUser: vi.fn(async () => identity.user),
}));

const HAS_DB = Boolean(process.env.DATABASE_URL);
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let companyA: number;
let companyB: number;
let invoiceA: number;
let invoiceB: number;
let vendorB: number;
let accountB: number;
let categoryA: number;
const userAId = "tenant-isolation-user-a";
const userBId = "tenant-isolation-user-b";

let listInvoices: (request: Request) => Promise<Response>;
let patchInvoice: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let deleteInvoice: typeof patchInvoice;
let patchVendor: typeof patchInvoice;
let patchAccount: typeof patchInvoice;
let listBudgetEntries: (request: Request) => Promise<Response>;
let exportCashFlow: (request: Request) => Promise<Response>;
let getInvoice: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let getDocument: typeof getInvoice;

function companyRequest(url: string, companyId: number, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", `financed_company_id=${companyId}`);
  return new Request(url, { ...init, headers });
}

function context(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

beforeAll(async () => {
  if (!HAS_DB) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });

  const [invoiceListModule, invoiceModule, vendorModule, accountModule, budgetModule, cashModule] = await Promise.all([
    import("@/app/api/invoices/route"),
    import("@/app/api/invoices/[id]/route"),
    import("@/app/api/settings/vendors/[id]/route"),
    import("@/app/api/settings/chart-of-accounts/[id]/route"),
    import("@/app/api/budget/entries/route"),
    import("@/app/api/cash-flow/export/route"),
  ]);
  listInvoices = invoiceListModule.GET;
  patchInvoice = invoiceModule.PATCH as never;
  getInvoice = invoiceModule.GET as never;
  deleteInvoice = invoiceModule.DELETE as never;
  patchVendor = vendorModule.PATCH as never;
  patchAccount = accountModule.PATCH as never;
  listBudgetEntries = budgetModule.GET as never;
  exportCashFlow = cashModule.GET;
  getDocument = (await import("@/app/api/invoices/[id]/document/route")).GET as never;

  const stamp = `${Date.now()}-${Math.random()}`;
  const companies = await db.insert(schema.companies).values([
    { name: `Isolation A ${stamp}`, baseCurrency: "EUR" },
    { name: `Isolation B ${stamp}`, baseCurrency: "GBP" },
  ]).returning({ id: schema.companies.id });
  companyA = companies[0].id;
  companyB = companies[1].id;
  await db.insert(schema.authUsers).values([
    { id: userAId, email: `a-${stamp}@example.test`, name: "User A" },
    { id: userBId, email: `b-${stamp}@example.test`, name: "User B" },
  ]);
  await db.insert(schema.companyMembers).values([
    { userId: userAId, companyId: companyA },
    { userId: userBId, companyId: companyB },
  ]);
  identity.user = { id: userAId, email: `a-${stamp}@example.test`, name: "User A" };

  const [vendor] = await db.insert(schema.vendors).values({ companyId: companyB, name: `Vendor B ${stamp}` }).returning();
  vendorB = vendor.id;
  const [account] = await db.insert(schema.chartOfAccounts).values({
    companyId: companyB,
    code: `B${Date.now()}`,
    name: "Company B Expense",
    type: "expense",
  }).returning();
  accountB = account.id;

  const invoices = await db.insert(schema.supplierInvoices).values([
    { companyId: companyA, invoiceNumber: `A-${stamp}`, grossAmount: "10", paymentStatus: "Unpaid" },
    { companyId: companyB, vendorId: vendorB, invoiceNumber: `B-${stamp}`, grossAmount: "20", paymentStatus: "Unpaid" },
  ]).returning({ id: schema.supplierInvoices.id });
  invoiceA = invoices[0].id;
  invoiceB = invoices[1].id;
  await db.insert(schema.supplierInvoiceDocuments).values({
    invoiceId: invoiceA,
    originalFilename: "company-a-confidential.pdf",
    storagePath: "object:companies/company-a/confidential.pdf",
    mimeType: "application/pdf",
  });

  const [category] = await db.insert(schema.budgetCategories).values({ companyId: companyA, name: `Category A ${stamp}` }).returning();
  categoryA = category.id;
  await db.insert(schema.budgetEntries).values([
    { companyId: companyA, budgetCategoryId: categoryA, month: "2026-08", amount: "100.00" },
    { companyId: companyB, budgetCategoryId: (await db.insert(schema.budgetCategories).values({ companyId: companyB, name: `Category B ${stamp}` }).returning())[0].id, month: "2026-08", amount: "200.00" },
  ]);
});

afterAll(async () => {
  if (!HAS_DB) return;
  await db.delete(schema.budgetEntries).where(inArray(schema.budgetEntries.companyId, [companyA, companyB]));
  await db.delete(schema.budgetCategories).where(inArray(schema.budgetCategories.companyId, [companyA, companyB]));
  await db.delete(schema.supplierInvoiceDocuments).where(eq(schema.supplierInvoiceDocuments.invoiceId, invoiceA));
  await db.delete(schema.supplierInvoices).where(inArray(schema.supplierInvoices.companyId, [companyA, companyB]));
  await db.delete(schema.chartOfAccounts).where(inArray(schema.chartOfAccounts.companyId, [companyA, companyB]));
  await db.delete(schema.vendors).where(inArray(schema.vendors.companyId, [companyA, companyB]));
  await db.delete(schema.companyMembers).where(inArray(schema.companyMembers.companyId, [companyA, companyB]));
  await db.delete(schema.companies).where(inArray(schema.companies.id, [companyA, companyB]));
  await db.delete(schema.authUsers).where(inArray(schema.authUsers.id, [userAId, userBId]));
  await pool.end();
});

describe("multi-company route isolation", () => {
  it.skipIf(!HAS_DB)("returns zero Company A invoice data or document bytes to User B", async () => {
    identity.user = { id: userBId, email: "b@example.test", name: "User B" };
    const forgedCompanyARequest = companyRequest(`http://localhost/api/invoices/${invoiceA}`, companyA);
    const invoiceResponse = await getInvoice(forgedCompanyARequest, context(invoiceA));
    const documentResponse = await getDocument(
      companyRequest(`http://localhost/api/invoices/${invoiceA}/document`, companyA),
      context(invoiceA),
    );
    expect(invoiceResponse.status).toBe(404);
    expect(await invoiceResponse.json()).toEqual({ error: "Not found" });
    expect(documentResponse.status).toBe(404);
    expect(documentResponse.headers.get("content-type")).toContain("application/json");
  });

  it.skipIf(!HAS_DB)("ignores a forged Company B cookie for User A and returns zero Company B invoices", async () => {
    identity.user = { id: userAId, email: "a@example.test", name: "User A" };
    const response = await listInvoices(companyRequest("http://localhost/api/invoices", companyB));
    const rows = await response.json() as Array<{ id: number }>;
    expect(rows.some((row) => row.id === invoiceA)).toBe(true);
    expect(rows.some((row) => row.id === invoiceB)).toBe(false);
  });

  it.skipIf(!HAS_DB)("lists only active-company invoices", async () => {
    identity.user = { id: userAId, email: "a@example.test", name: "User A" };
    const response = await listInvoices(companyRequest("http://localhost/api/invoices", companyA));
    const rows = await response.json() as Array<{ id: number }>;
    expect(rows.some((row) => row.id === invoiceA)).toBe(true);
    expect(rows.some((row) => row.id === invoiceB)).toBe(false);
  });

  it.skipIf(!HAS_DB)("treats Company B invoice GET/PATCH/DELETE as not found for Company A", async () => {
    identity.user = { id: userAId, email: "a@example.test", name: "User A" };
    const route = await import("@/app/api/invoices/[id]/route");
    const getResponse = await route.GET(companyRequest(`http://localhost/api/invoices/${invoiceB}`, companyA) as never, context(invoiceB));
    const patchResponse = await patchInvoice(companyRequest(`http://localhost/api/invoices/${invoiceB}`, companyA, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "must not change" }),
    }), context(invoiceB));
    const deleteResponse = await deleteInvoice(companyRequest(`http://localhost/api/invoices/${invoiceB}`, companyA, { method: "DELETE" }), context(invoiceB));
    expect([getResponse.status, patchResponse.status, deleteResponse.status]).toEqual([404, 404, 404]);
  });

  it.skipIf(!HAS_DB)("prevents cross-company vendor and account updates", async () => {
    identity.user = { id: userAId, email: "a@example.test", name: "User A" };
    const vendorResponse = await patchVendor(companyRequest(`http://localhost/api/settings/vendors/${vendorB}`, companyA, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Leaked update" }),
    }), context(vendorB));
    const accountResponse = await patchAccount(companyRequest(`http://localhost/api/settings/chart-of-accounts/${accountB}`, companyA, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Leaked update" }),
    }), context(accountB));
    expect(vendorResponse.status).toBe(404);
    expect(accountResponse.status).toBe(404);
  });

  it.skipIf(!HAS_DB)("filters Budget entries and Cash Flow export by active company", async () => {
    identity.user = { id: userAId, email: "a@example.test", name: "User A" };
    const budgetResponse = await listBudgetEntries(companyRequest("http://localhost/api/budget/entries?month=2026-08", companyA));
    const budgetRows = await budgetResponse.json() as Array<{ companyId: number }>;
    expect(budgetRows.length).toBeGreaterThan(0);
    expect(budgetRows.every((row) => row.companyId === companyA)).toBe(true);

    const cashResponse = await exportCashFlow(companyRequest("http://localhost/api/cash-flow/export", companyA));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await cashResponse.arrayBuffer());
    const ids: number[] = [];
    workbook.getWorksheet("Outstanding Payables")?.getColumn("id").eachCell((cell, row) => {
      if (row > 1 && typeof cell.value === "number") ids.push(cell.value);
    });
    expect(ids).toContain(invoiceA);
    expect(ids).not.toContain(invoiceB);
  });
});
