import { asc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { type NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { companies } from "@/src/db/schema";

export const ACTIVE_COMPANY_COOKIE = "financed_company_id";

export const ACTIVE_COMPANY_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
};

// A deployment-wide transaction lock used only while bootstrapping an empty
// companies table. It does not serialize normal company resolution or creation.
const INITIAL_COMPANY_LOCK_KEY = 1_179_868_371;

export function parseActiveCompanyId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function resolveActiveCompany(activeCompanyCookie?: string) {
  const db = getDb();
  const requestedId = parseActiveCompanyId(activeCompanyCookie);

  if (requestedId !== null) {
    const [requested] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, requestedId))
      .limit(1);
    if (requested) return requested;
  }

  const [existing] = await db
    .select()
    .from(companies)
    .orderBy(asc(companies.id))
    .limit(1);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INITIAL_COMPANY_LOCK_KEY})`);

    const [afterLock] = await tx
      .select()
      .from(companies)
      .orderBy(asc(companies.id))
      .limit(1);
    if (afterLock) return afterLock;

    const [created] = await tx
      .insert(companies)
      .values({ name: "My Company", baseCurrency: "USD" })
      .returning();
    return created;
  });
}

export async function getActiveCompany() {
  const cookieStore = await cookies();
  return resolveActiveCompany(cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value);
}

export async function getActiveCompanyFromRequest(request: Request) {
  return resolveActiveCompany(cookieValue(request, ACTIVE_COMPANY_COOKIE));
}

export function setActiveCompanyCookie(response: NextResponse, companyId: number) {
  response.cookies.set(ACTIVE_COMPANY_COOKIE, String(companyId), ACTIVE_COMPANY_COOKIE_OPTIONS);
  return response;
}
