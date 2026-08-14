import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  vendors,
  costCentres,
  chartOfAccounts,
  companies,
} from "@/src/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  isAmountMismatch,
  calculateBaseAmount,
  validatePositiveRate,
  validateAmount,
  validateBaseAmount,
} from "@/src/lib/invoice-validation";

const UpdateSchema = z.object({
  vendorId: z.number().nullable().optional(),
  newVendorName: z.string().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().min(1).max(20).optional(),
  currencyType: z.enum(["fiat", "crypto"]).optional(),
  fxRateToBase: z.string().nullable().optional(),
  netAmount: z.string().nullable().optional(),
  vatAmount: z.string().nullable().optional(),
  grossAmount: z.string().nullable().optional(),
  costCentreId: z.number().nullable().optional(),
  expenseAccountId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, Number(id)));

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [docs, vendorList, costCentreList, accountList, [company]] = await Promise.all([
    db.select().from(supplierInvoiceDocuments).where(eq(supplierInvoiceDocuments.invoiceId, invoice.id)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.companyId, invoice.companyId)),
    db.select().from(costCentres).where(eq(costCentres.companyId, invoice.companyId)),
    db.select().from(chartOfAccounts).where(eq(chartOfAccounts.companyId, invoice.companyId)),
    db.select({ baseCurrency: companies.baseCurrency }).from(companies).where(eq(companies.id, invoice.companyId)),
  ]);

  return NextResponse.json({
    invoice,
    documents: docs,
    vendors: vendorList,
    costCentres: costCentreList,
    accounts: accountList,
    baseCurrency: company?.baseCurrency ?? "EUR",
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, Number(id)));

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch company baseCurrency for FX rate logic
  const [company] = await db
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, existing.companyId));
  const baseCurrency = company?.baseCurrency ?? "EUR";

  // ── Validate and normalize decimal inputs ──────────────────────────────────
  const errors: string[] = [];

  let normalizedNet: string | null | undefined;
  let normalizedVat: string | null | undefined;
  let normalizedGross: string | null | undefined;
  let normalizedRate: string | null | undefined;

  if (data.netAmount !== undefined) {
    if (data.netAmount === null) {
      normalizedNet = null;
    } else {
      try { normalizedNet = validateAmount(data.netAmount, "Net amount"); }
      catch (e) { errors.push((e as Error).message); }
    }
  }
  if (data.vatAmount !== undefined) {
    if (data.vatAmount === null) {
      normalizedVat = null;
    } else {
      try { normalizedVat = validateAmount(data.vatAmount, "VAT amount"); }
      catch (e) { errors.push((e as Error).message); }
    }
  }
  if (data.grossAmount !== undefined) {
    if (data.grossAmount === null) {
      normalizedGross = null;
    } else {
      try { normalizedGross = validateAmount(data.grossAmount, "Gross amount"); }
      catch (e) { errors.push((e as Error).message); }
    }
  }
  if (data.fxRateToBase !== undefined) {
    if (data.fxRateToBase === null) {
      normalizedRate = null;
    } else {
      try { normalizedRate = validatePositiveRate(data.fxRateToBase); }
      catch (e) { errors.push((e as Error).message); }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 422 });
  }

  // ── Validate database references ──────────────────────────────────────────
  const refErrors: string[] = [];

  if (data.vendorId !== undefined && data.vendorId !== null) {
    const [v] = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.id, data.vendorId), eq(vendors.companyId, existing.companyId)));
    if (!v) refErrors.push("Vendor does not exist or does not belong to this company.");
  }

  if (data.costCentreId !== undefined && data.costCentreId !== null) {
    const [cc] = await db
      .select({ id: costCentres.id })
      .from(costCentres)
      .where(and(eq(costCentres.id, data.costCentreId), eq(costCentres.companyId, existing.companyId)));
    if (!cc) refErrors.push("Cost centre does not exist or does not belong to this company.");
  }

  if (data.expenseAccountId !== undefined && data.expenseAccountId !== null) {
    const [acct] = await db
      .select({ id: chartOfAccounts.id, type: chartOfAccounts.type })
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.id, data.expenseAccountId), eq(chartOfAccounts.companyId, existing.companyId)));
    if (!acct) {
      refErrors.push("Expense account does not exist or does not belong to this company.");
    } else if (acct.type !== "expense") {
      refErrors.push("The selected account is not an expense account.");
    }
  }

  if (refErrors.length > 0) {
    return NextResponse.json({ error: refErrors.join(" ") }, { status: 422 });
  }

  // ── Determine final status ─────────────────────────────────────────────────
  const requestedStatus = data.status;
  let finalStatus: "draft" | "approved";

  if (requestedStatus !== undefined) {
    if (existing.status === "approved" && requestedStatus === "draft") {
      return NextResponse.json(
        { error: "Cannot downgrade an approved invoice to draft." },
        { status: 422 }
      );
    }
    finalStatus = requestedStatus;
  } else {
    finalStatus = existing.status;
  }

  // ── Resolve final values ───────────────────────────────────────────────────
  const finalNet = normalizedNet !== undefined ? normalizedNet : existing.netAmount;
  const finalVat = normalizedVat !== undefined ? normalizedVat : existing.vatAmount;
  const finalGross = normalizedGross !== undefined ? normalizedGross : existing.grossAmount;
  const finalCurrencyType = data.currencyType ?? existing.currencyType;
  const finalCurrency = data.currency ?? existing.currency;
  const finalVendorId = data.vendorId !== undefined ? data.vendorId : existing.vendorId;
  const finalInvoiceNumber = data.invoiceNumber !== undefined ? data.invoiceNumber : existing.invoiceNumber;
  const finalInvoiceDate = data.invoiceDate !== undefined ? data.invoiceDate : existing.invoiceDate;

  // ── Currency change: invalidate stale FX rate ─────────────────────────────
  const currencyChanged = data.currency !== undefined && data.currency !== existing.currency;
  let effectiveRate: string | null | undefined;

  if (finalCurrency === baseCurrency) {
    effectiveRate = "1";
  } else if (currencyChanged) {
    // Currency changed to a foreign currency: discard old rate, accept only
    // an explicitly supplied new rate
    effectiveRate = normalizedRate !== undefined ? normalizedRate : null;
  } else {
    // No currency change — use the supplied rate or fall back to stored
    effectiveRate = normalizedRate !== undefined ? normalizedRate : existing.fxRateToBase;
  }

  // ── Approval validation ────────────────────────────────────────────────────
  if (finalStatus === "approved") {
    const missing: string[] = [];
    const resolvedVendorId = data.newVendorName ? "pending" : finalVendorId;
    if (!resolvedVendorId) missing.push("vendor");
    if (!finalInvoiceNumber) missing.push("invoice number");
    if (!finalInvoiceDate) missing.push("invoice date");
    if (!finalCurrency) missing.push("currency");
    if (!finalNet) missing.push("net amount");
    if (finalVat === null || finalVat === undefined) missing.push("VAT amount (use 0 if none)");
    if (!finalGross) missing.push("gross amount");

    const docCount = await db
      .select({ id: supplierInvoiceDocuments.id })
      .from(supplierInvoiceDocuments)
      .where(eq(supplierInvoiceDocuments.invoiceId, existing.id))
      .limit(1);
    if (docCount.length === 0) missing.push("attached source document");

    if (finalCurrency !== baseCurrency && !effectiveRate) {
      missing.push("FX rate (required for foreign currency)");
    }

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Cannot approve: missing ${missing.join(", ")}.` },
        { status: 422 }
      );
    }

    // Block all-zero approval
    const { Decimal } = await import("@/src/lib/decimal");
    const netDec = new Decimal(finalNet ?? "0");
    const vatDec = new Decimal(finalVat ?? "0");
    const grossDec = new Decimal(finalGross ?? "0");
    if (netDec.isZero() && vatDec.isZero() && grossDec.isZero()) {
      return NextResponse.json(
        { error: "Cannot approve: invoice amounts are all zero." },
        { status: 422 }
      );
    }

    if (isAmountMismatch(finalNet, finalVat, finalGross, finalCurrencyType)) {
      return NextResponse.json(
        { error: "Cannot approve: net + VAT does not match gross within the accepted tolerance." },
        { status: 422 }
      );
    }
  }

  // ── Validate base amount overflow ─────────────────────────────────────────
  if (effectiveRate) {
    try {
      validateBaseAmount(calculateBaseAmount(finalNet, effectiveRate), "Base net amount");
      validateBaseAmount(calculateBaseAmount(finalVat, effectiveRate), "Base VAT amount");
      validateBaseAmount(calculateBaseAmount(finalGross, effectiveRate), "Base gross amount");
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 422 });
    }
  }

  // ── Vendor creation inside a transaction ───────────────────────────────────
  const vendorId = data.vendorId;
  if (data.newVendorName && !vendorId) {
    try {
      const result = await db.transaction(async (tx) => {
        const [v] = await tx
          .insert(vendors)
          .values({ companyId: existing.companyId, name: data.newVendorName! })
          .returning();

        const updateValues = buildUpdateValues(
          data, normalizedNet, normalizedVat, normalizedGross,
          effectiveRate, finalNet, finalVat, finalGross, finalStatus, v.id,
          currencyChanged
        );

        const [updated] = await tx
          .update(supplierInvoices)
          .set(updateValues)
          .where(eq(supplierInvoices.id, Number(id)))
          .returning();

        return updated;
      });

      if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(result);
    } catch (err) {
      console.error("Transaction error:", err);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
  }

  // ── Non-transactional update (no new vendor) ───────────────────────────────
  const updateValues = buildUpdateValues(
    data, normalizedNet, normalizedVat, normalizedGross,
    effectiveRate, finalNet, finalVat, finalGross, finalStatus, vendorId,
    currencyChanged
  );

  const [updated] = await db
    .update(supplierInvoices)
    .set(updateValues)
    .where(eq(supplierInvoices.id, Number(id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

function buildUpdateValues(
  data: z.infer<typeof UpdateSchema>,
  normalizedNet: string | null | undefined,
  normalizedVat: string | null | undefined,
  normalizedGross: string | null | undefined,
  effectiveRate: string | null | undefined,
  finalNet: string | null | undefined,
  finalVat: string | null | undefined,
  finalGross: string | null | undefined,
  finalStatus: "draft" | "approved",
  vendorId: number | null | undefined,
  currencyChanged: boolean,
): Record<string, unknown> {
  const updateValues: Record<string, unknown> = {
    updatedAt: new Date(),
    status: finalStatus,
  };
  if (vendorId !== undefined) updateValues.vendorId = vendorId;
  if (data.invoiceNumber !== undefined) updateValues.invoiceNumber = data.invoiceNumber;
  if (data.invoiceDate !== undefined) updateValues.invoiceDate = data.invoiceDate;
  if (data.dueDate !== undefined) updateValues.dueDate = data.dueDate;
  if (data.currency !== undefined) updateValues.currency = data.currency;
  if (data.currencyType !== undefined) updateValues.currencyType = data.currencyType;
  if (normalizedNet !== undefined) updateValues.netAmount = normalizedNet;
  if (normalizedVat !== undefined) updateValues.vatAmount = normalizedVat;
  if (normalizedGross !== undefined) updateValues.grossAmount = normalizedGross;

  // Always write rate when currency changed or rate was explicitly provided
  if (effectiveRate !== undefined || currencyChanged) {
    updateValues.fxRateToBase = effectiveRate ?? null;
  }

  if (data.costCentreId !== undefined) updateValues.costCentreId = data.costCentreId;
  if (data.expenseAccountId !== undefined) updateValues.expenseAccountId = data.expenseAccountId;
  if (data.notes !== undefined) updateValues.notes = data.notes;

  // Recalculate base amounts when any monetary field or FX rate changes
  const monetaryFieldChanged =
    normalizedNet !== undefined ||
    normalizedVat !== undefined ||
    normalizedGross !== undefined ||
    effectiveRate !== undefined ||
    currencyChanged;

  if (monetaryFieldChanged) {
    if (effectiveRate) {
      updateValues.baseNetAmount = calculateBaseAmount(finalNet, effectiveRate);
      updateValues.baseVatAmount = calculateBaseAmount(finalVat, effectiveRate);
      updateValues.baseGrossAmount = calculateBaseAmount(finalGross, effectiveRate);
    } else {
      updateValues.baseNetAmount = null;
      updateValues.baseVatAmount = null;
      updateValues.baseGrossAmount = null;
    }
  }

  return updateValues;
}
