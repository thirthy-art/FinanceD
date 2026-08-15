import { Decimal } from "@/src/lib/decimal";

export interface VendorInvoiceAmount {
  status: "draft" | "approved";
  currency: string;
  grossAmount: string | null;
  baseGrossAmount: string | null;
}

export interface CurrencyTotal {
  currency: string;
  amount: string;
}

function addAmount(totals: Map<string, Decimal>, currency: string, value: string | null) {
  if (!value) return;
  try {
    totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(new Decimal(value)));
  } catch {
    // Ignore malformed historical values rather than mixing them into a total.
  }
}

function serializeTotals(totals: Map<string, Decimal>): CurrencyTotal[] {
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed() }));
}

export function calculateVendorInvoiceTotals(invoices: VendorInvoiceAmount[]) {
  const approved = new Map<string, Decimal>();
  const drafts = new Map<string, Decimal>();
  let baseApproved: Decimal | null = null;

  for (const invoice of invoices) {
    if (invoice.status === "approved") {
      addAmount(approved, invoice.currency, invoice.grossAmount);
      if (invoice.baseGrossAmount) {
        try {
          baseApproved = (baseApproved ?? new Decimal(0)).plus(new Decimal(invoice.baseGrossAmount));
        } catch {
          // Invalid historical base amounts are excluded from the optional base total.
        }
      }
    } else {
      addAmount(drafts, invoice.currency, invoice.grossAmount);
    }
  }

  return {
    approved: serializeTotals(approved),
    drafts: serializeTotals(drafts),
    baseApproved: baseApproved?.toFixed() ?? null,
  };
}
