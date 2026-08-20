import {
  ActiveCompanySelectionRequiredError,
  getActiveCompany,
} from "@/src/lib/active-company";

export async function getActiveCompanyForPage(
  resolve: typeof getActiveCompany = getActiveCompany,
) {
  try {
    return await resolve();
  } catch (error) {
    if (error instanceof ActiveCompanySelectionRequiredError) return null;
    throw error;
  }
}
