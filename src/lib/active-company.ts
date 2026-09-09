import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/src/db";
import { companies, companyMembers } from "@/src/db/schema";
import {
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "@/src/lib/current-user";

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

export class AuthenticationRequiredError extends Error {
  readonly code = "AUTHENTICATION_REQUIRED";

  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class NoCompanyAssignedError extends Error {
  readonly code = "NO_COMPANY_ASSIGNED";

  constructor() {
    super("No company assigned.");
    this.name = "NoCompanyAssignedError";
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

export interface AuthorizedCompany {
  id: number;
  name: string;
  baseCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveCompanyDependencies {
  getUser: () => Promise<AuthenticatedUser | null>;
  listCompanies: (userId: string) => Promise<AuthorizedCompany[]>;
}

export async function listCompaniesForUser(userId: string): Promise<AuthorizedCompany[]> {
  return getDb()
    .select({
      id: companies.id,
      name: companies.name,
      baseCurrency: companies.baseCurrency,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companyMembers.companyId, companies.id))
    .where(eq(companyMembers.userId, userId))
    .orderBy(asc(companies.id));
}

const defaultDependencies: ActiveCompanyDependencies = {
  getUser: getAuthenticatedUser,
  listCompanies: listCompaniesForUser,
};

export async function getAuthorizedCompanies(
  dependencies: ActiveCompanyDependencies = defaultDependencies,
) {
  const user = await dependencies.getUser();
  if (!user) throw new AuthenticationRequiredError();
  return dependencies.listCompanies(user.id);
}

export async function resolveActiveCompany(
  activeCompanyCookie?: string,
  dependencies: ActiveCompanyDependencies = defaultDependencies,
) {
  const authorizedCompanies = await getAuthorizedCompanies(dependencies);
  if (authorizedCompanies.length === 0) throw new NoCompanyAssignedError();
  const requestedId = parseActiveCompanyId(activeCompanyCookie);

  if (requestedId !== null) {
    const requested = authorizedCompanies.find((company) => company.id === requestedId);
    if (requested) return requested;
  }

  if (authorizedCompanies.length === 1) return authorizedCompanies[0];
  throw new ActiveCompanySelectionRequiredError();
}

export async function getActiveCompany() {
  const cookieStore = await cookies();
  return resolveActiveCompany(cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value);
}

export async function getActiveCompanyFromRequest(
  request: Request,
  dependencies: ActiveCompanyDependencies = defaultDependencies,
) {
  try {
    return await resolveActiveCompany(cookieValue(request, ACTIVE_COMPANY_COOKIE), dependencies);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 401 },
      );
    }
    if (error instanceof NoCompanyAssignedError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 },
      );
    }
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
