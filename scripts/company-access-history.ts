import "dotenv/config";

import { closeDb, getDb } from "../src/db";
import {
  listCompanyAccessHistory,
  reconstructAccessPeriods,
  type CompanyAccessHistoryEvent,
} from "../src/lib/company-access-history";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

const eventLabels: Record<CompanyAccessHistoryEvent["eventType"], string> = {
  invite_created: "Pending invite created",
  invite_claimed: "Pending invite claimed",
  membership_granted: "Access granted",
  membership_revoked: "Access revoked",
  membership_existing_at_audit_start: "Access present at audit start",
};

function printHistory(events: CompanyAccessHistoryEvent[]) {
  if (events.length === 0) {
    console.log("No company access history matched the supplied filters.");
    return;
  }

  const groups = new Map<string, CompanyAccessHistoryEvent[]>();
  for (const event of events) {
    const key = `${event.companyId}\u0000${event.normalizedEmail}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const currentAccess = group.some((event) => event.currentAccess);
    console.log(`Company ${first.companyId} — ${first.companyName}`);
    console.log("");
    console.log(first.normalizedEmail);
    console.log("");
    for (const event of group) {
      console.log(`  ${formatTimestamp(event.occurredAt)}`);
      console.log(`  ${eventLabels[event.eventType]}`);
      console.log(`  Actor: ${event.actor}`);
      console.log(`  Source: ${event.source}`);
      console.log("");
    }
    console.log(`Current access: ${currentAccess ? "YES" : "NO"}`);
    console.log("");
    console.log("Access periods:");
    const periods = reconstructAccessPeriods(group);
    if (periods.length === 0) console.log("No membership periods recorded.");
    for (const period of periods) {
      const end = period.end
        ? formatTimestamp(period.end)
        : currentAccess ? "present" : "unclosed audit period (no current membership)";
      console.log(`${formatTimestamp(period.start)} → ${end}`);
    }
    console.log("");
  }
}

async function main() {
  const rawCompanyId = option("--company-id");
  const email = option("--email");
  if (!rawCompanyId && !email) {
    throw new Error("Use --company-id, --email, or both.");
  }
  if (rawCompanyId && !/^[1-9]\d*$/.test(rawCompanyId)) {
    throw new Error("--company-id must be a positive integer.");
  }
  printHistory(await listCompanyAccessHistory(getDb(), {
    companyId: rawCompanyId ? Number(rawCompanyId) : undefined,
    email,
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Access history lookup failed.");
    process.exitCode = 1;
  })
  .finally(closeDb);
