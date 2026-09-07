import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("private-beta auth and tenant architecture", () => {
  it("uses the Next.js 16 proxy convention while leaving Auth.js endpoints public", async () => {
    const proxy = await source("proxy.ts");
    expect(proxy).toContain("export const proxy = auth");
    expect(proxy).toContain("?!api|sign-in");
  });

  it("keeps membership minimal and migration 0018 free of roles, status, and RLS", async () => {
    const migration = await source("drizzle/0018_polite_thing.sql");
    const membership = migration.slice(
      migration.indexOf('CREATE TABLE "company_members"'),
      migration.indexOf('ALTER TABLE "auth_accounts"'),
    );
    expect(membership).toContain('"user_id" text NOT NULL');
    expect(membership).toContain('"company_id" integer NOT NULL');
    expect(membership).toContain('"created_at" timestamp DEFAULT now() NOT NULL');
    expect(membership).not.toMatch(/role|status|active|permission/i);
    expect(migration).not.toMatch(/row level security|create policy|app\.company_id/i);
  });

  it("routes invoice documents, AI extraction, vendors, and PSP/reconciliation through the central company boundary", async () => {
    const protectedRoutes = [
      "app/api/invoices/[id]/document/route.ts",
      "app/api/invoices/[id]/extract/route.ts",
      "app/api/settings/vendors/route.ts",
      "app/api/payment-accounts/route.ts",
      "app/api/payment-accounts/import/route.ts",
      "app/api/reconciliation/run/route.ts",
    ];
    for (const route of protectedRoutes) {
      expect(await source(route), route).toContain("getActiveCompanyFromRequest");
    }
  });

  it("routes every non-Auth.js API through the authenticated company boundary", async () => {
    const apiRoot = path.join(process.cwd(), "app", "api");
    const routes = (await readdir(apiRoot, { recursive: true }))
      .filter((entry) => entry.endsWith("route.ts"))
      .map((entry) => path.join("app", "api", entry).replaceAll("\\", "/"));
    const publicRoutes = new Set(["app/api/auth/[...nextauth]/route.ts"]);

    for (const route of routes.filter((entry) => !publicRoutes.has(entry))) {
      expect(await source(route), route).toMatch(/getActiveCompany|getAuthorizedCompanies/);
    }
  });

  it("contains no production authentication bypass or generic credentials framework", async () => {
    const files = await Promise.all([
      source("auth.ts"), source("src/lib/active-company.ts"), source("src/db/schema.ts"),
    ]);
    const combined = files.join("\n");
    expect(combined).not.toMatch(/AUTH_DISABLED|TRUST_ALL_USERS|integration_credentials|provider_registry/i);
  });
});
