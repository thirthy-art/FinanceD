import { NextResponse } from "next/server";
import {
  activeCompanyIdFromRequest,
  AuthenticationRequiredError,
  getAuthorizedCompanies,
} from "@/src/lib/active-company";

export async function GET(request: Request) {
  let authorized;
  try {
    authorized = await getAuthorizedCompanies();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 401 });
    }
    throw error;
  }
  const rows = authorized.map(({ id, name, baseCurrency }) => ({ id, name, baseCurrency }));

  const requestedId = activeCompanyIdFromRequest(request);
  const selected = requestedId === null ? undefined : rows.find((company) => company.id === requestedId);
  const activeCompanyId = selected?.id ?? (rows.length === 1 ? rows[0].id : null);
  return NextResponse.json({ companies: rows, activeCompanyId });
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json(
    { error: "Company creation is not available in the private beta." },
    { status: 405, headers: { Allow: "GET" } },
  );
}
