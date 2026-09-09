import "dotenv/config";

import { closeDb, getDb } from "../src/db";
import {
  grantCompanyAccess,
  provisionCompanyWithFirstUser,
  type AccessProvisioningResult,
} from "../src/lib/company-access-provisioning";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function printResult(result: AccessProvisioningResult) {
  console.log(`Company: ${result.companyName} (${result.companyId})`);
  console.log(`Email: ${result.normalizedEmail}`);
  console.log(`Access: ${result.status}`);
}

async function main() {
  const action = process.argv[2];
  const email = option("--email");
  if (!email) throw new Error("--email is required.");

  if (action === "provision") {
    const companyName = option("--company-name");
    if (!companyName) throw new Error("--company-name is required.");
    printResult(await provisionCompanyWithFirstUser(getDb(), { companyName, email }));
    return;
  }

  if (action === "grant") {
    const rawCompanyId = option("--company-id");
    if (!rawCompanyId || !/^[1-9]\d*$/.test(rawCompanyId)) {
      throw new Error("--company-id must be a positive integer.");
    }
    printResult(await grantCompanyAccess(getDb(), { companyId: Number(rawCompanyId), email }));
    return;
  }

  throw new Error(
    "Use auth:provision with --company-name and --email, or auth:grant with --company-id and --email.",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Company access provisioning failed.");
    process.exitCode = 1;
  })
  .finally(closeDb);
