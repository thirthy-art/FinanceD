export interface VendorIdentityCandidate {
  id: number;
  name: string;
  taxId: string | null;
  normalizedTaxId?: string | null;
  vendorStatus?: "draft" | "active";
  invoiceCount?: number;
}

export function normalizeVendorTaxId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized || null;
}

export function normalizeVendorName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
  return normalized || null;
}

export function findVendorIdentityMatches(
  name: string | null | undefined,
  taxId: string | null | undefined,
  candidates: VendorIdentityCandidate[],
): { matchedOn: "taxId" | "name" | null; candidates: VendorIdentityCandidate[] } {
  const normalizedTaxId = normalizeVendorTaxId(taxId);
  if (normalizedTaxId) {
    const taxMatches = candidates.filter((candidate) =>
      normalizeVendorTaxId(candidate.normalizedTaxId ?? candidate.taxId) === normalizedTaxId
    );
    if (taxMatches.length > 0) return { matchedOn: "taxId", candidates: taxMatches };
  }

  const normalizedName = normalizeVendorName(name);
  if (normalizedName) {
    const nameMatches = candidates.filter((candidate) => normalizeVendorName(candidate.name) === normalizedName);
    if (nameMatches.length > 0) return { matchedOn: "name", candidates: nameMatches };
  }

  return { matchedOn: null, candidates: [] };
}

export function hasPossibleVendorDuplicate(candidate: VendorIdentityCandidate, vendors: VendorIdentityCandidate[]): boolean {
  const taxId = normalizeVendorTaxId(candidate.normalizedTaxId ?? candidate.taxId);
  const name = normalizeVendorName(candidate.name);
  return vendors.some((other) => {
    if (other.id === candidate.id) return false;
    const sameTaxId = taxId !== null && normalizeVendorTaxId(other.normalizedTaxId ?? other.taxId) === taxId;
    const sameName = name !== null && normalizeVendorName(other.name) === name;
    return sameTaxId || sameName;
  });
}
