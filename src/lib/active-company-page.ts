import {
  ActiveCompanySelectionRequiredError,
  AuthenticationRequiredError,
  getActiveCompany,
  NoCompanyAssignedError,
} from "@/src/lib/active-company";
import { redirect } from "next/navigation";

export async function getActiveCompanyForPage(
  resolve: typeof getActiveCompany = getActiveCompany,
) {
  try {
    return await resolve();
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (
      error instanceof ActiveCompanySelectionRequiredError
      || error instanceof NoCompanyAssignedError
    ) return null;
    throw error;
  }
}
