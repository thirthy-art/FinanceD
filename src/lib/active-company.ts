import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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

export class ActiveCompanySelectionRequiredError extends Error {
  readonly code = "ACTIVE_COMPANY_REQUIRED";

  constructor() {
    super("Active company selection required.");
    this.name = "ActiveCompanySelectionRequiredError";
  }
}

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

export function activeCompanyIdFromRequest(request: Request): number | null {
  return parseActiveCompanyId(cookieValue(request, ACTIVE_COMPANY_COOKIE));
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

  const existing = await db
    .select()
    .from(companies)
    .orderBy(asc(companies.id))
    .limit(2);
  if (existing.length === 1) return existing[0];
  throw new ActiveCompanySelectionRequiredError();
}

export async function getActiveCompany() {
  const cookieStore = await cookies();
  return resolveActiveCompany(cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value);
}

export async function getActiveCompanyFromRequest(request: Request) {
  try {
    return await resolveActiveCompany(cookieValue(request, ACTIVE_COMPANY_COOKIE));
  } catch (error) {
    if (error instanceof ActiveCompanySelectionRequiredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    throw error;
  }
}

export function setActiveCompanyCookie(response: NextResponse, companyId: number) {
  response.cookies.set(ACTIVE_COMPANY_COOKIE, String(companyId), ACTIVE_COMPANY_COOKIE_OPTIONS);
  return response;
}
