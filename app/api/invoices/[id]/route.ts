import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/src/db";
import {
  supplierInvoices,
  supplierInvoiceDocuments,
  supplierInvoiceLines,
  vendors,
  costCentres,
  chartOfAccounts,
  companies,
} from "@/src/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  isAmountMismatch,
  calculateBaseAmount,
  validatePositiveRate,
  validateAmount,
  validateSignedAmount,
  validateBaseAmount,
  isVatRateValid,
} from "@/src/lib/invoice-validation";
import {
  InvoiceLineInputSchema,
  normalizeInvoiceLineInput,
  validateLineRecognitionForApproval,
  validateLineAccountsForApproval,
  checkLineTotalsForApproval,
} from "@/src/lib/invoice-lines";
import { findVendorIdentityMatches, normalizeVendorTaxId } from "@/src/lib/vendor-identity";
import { getActiveCompanyFromRequest } from "@/src/lib/active-company";
import {
  deleteDocument,
  UnsafeDocumentStoragePathError,
} from "@/src/lib/document-storage";

const UpdateSchema = z.object({
  vendorId: z.number().nullable().optional(),
  newVendorName: z.string().trim().min(1).max(255).optional(),
  newVendorTaxId: z.string().trim().max(50).nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().min(1).max(20).optional(),
  currencyType: z.enum(["fiat", "crypto"]).optional(),
  fxRateToBase: z.string().nullable().optional(),
  netAmount: z.string().nullable().optional(),
  lineNetAdjustment: z.string().nullable().optional(),
  vatAmount: z.string().nullable().optional(),
  grossAmount: z.string().nullable().optional(),
  costCentreId: z.number().nullable().optional(),
  expenseAccountId: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(["draft", "approved"]).optional(),
  paymentStatus: z.enum(["Unpaid", "Paid"]).optional(),
  paidDate: z.string().nullable().optional(),
  lines: z.array(InvoiceLineInputSchema).max(1_000).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activeCompany = await getActiveCompanyFromRequest(req);
  if (activeCompany instanceof Response) return activeCompany;
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(supplierInvoices)
    .where(and(
      eq(supplierInvoices.id, Number(id)),
      eq(supplierInvoices.companyId, activeCompany.id),
    ));

  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [docs, lines, vendorList, costCentreList, accountList, [company]] = await Promise.all([
    db.select().from(supplierInvoiceDocuments).where(eq(supplierInvoiceDocuments.invoiceId, invoice.id)),
    db.select().from(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoice.id)).orderBy(asc(supplierInvoiceLines.position)),
    db.select({ id: vendors.id, name: vendors.name, taxId: vendors.taxId, normalizedTaxId: vendors.normalizedTaxId }).from(vendors).where(eq(vendors.companyId, invoice.companyId)),
    db.select().from(costCentres).where(eq(costCentres.companyId, invoice.companyId)),
    db.select().from(chartOfAccounts).where(eq(chartOfAccounts.companyId, invoice.companyId)),
    db.select({ baseCurrency: companies.baseCurrency }).from(companies).where(eq(companies.id, invoice.companyId)),
  ]);

  return NextResponse.json({
    invoice,
    documents: docs,
    lines,
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
  const activeCompany = await getActiveCompanyFromRequest(req);
  if (activeCompany instanceof Response) return activeCompany;

  const [existing] = await db
    .select()
    .from(supplierInvoices)
    .where(and(
      eq(supplierInvoices.id, Number(id)),
      eq(supplierInvoices.companyId, activeCompany.id),
    ));

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
  let normalizedLineNetAdjustment: string | undefined;
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
  if (data.lineNetAdjustment !== undefined) {
    try { normalizedLineNetAdjustment = validateSignedAmount(data.lineNetAdjustment, "Line net adjustment"); }
    catch (e) { errors.push((e as Error).message); }
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

  let normalizedLines: ReturnType<typeof normalizeInvoiceLineInput>[] | undefined;
  if (data.lines !== undefined) {
    try {
      normalizedLines = data.lines.map(normalizeInvoiceLineInput);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid invoice line." },
        { status: 422 },
      );
    }
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
      .select({ id: chartOfAccounts.id, type: chartOfAccounts.type, isActive: chartOfAccounts.isActive, isPosting: chartOfAccounts.isPosting })
      .from(chartOfAccounts)
      .where(and(eq(chartOfAccounts.id, data.expenseAccountId), eq(chartOfAccounts.companyId, existing.companyId)));
    if (!acct) {
      refErrors.push("Expense account does not exist or does not belong to this company.");
    } else if (acct.type !== "expense" || !acct.isActive || !acct.isPosting) {
      refErrors.push("The selected account is not an active posting expense account.");
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
  const finalLineNetAdjustment = normalizedLineNetAdjustment ?? existing.lineNetAdjustment;
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

    const linesToValidate = normalizedLines !== undefined
      ? normalizedLines
      : await db
          .select({
            recognitionTreatment: supplierInvoiceLines.recognitionTreatment,
            recognitionStartDate: supplierInvoiceLines.recognitionStartDate,
            recognitionEndDate: supplierInvoiceLines.recognitionEndDate,
            vatRate: supplierInvoiceLines.vatRate,
            accountingAccountNumber: supplierInvoiceLines.accountingAccountNumber,
            prepaidAccountNumber: supplierInvoiceLines.prepaidAccountNumber,
            netAmount: supplierInvoiceLines.netAmount,
            vatAmount: supplierInvoiceLines.vatAmount,
            grossAmount: supplierInvoiceLines.grossAmount,
          })
          .from(supplierInvoiceLines)
          .where(eq(supplierInvoiceLines.invoiceId, Number(id)));

    for (let i = 0; i < linesToValidate.length; i++) {
      const line = linesToValidate[i];
      if (!isVatRateValid(line.vatRate)) {
        return NextResponse.json(
          { error: `Cannot approve: Line ${i + 1} VAT rate must be between 0 and 100.` },
          { status: 422 }
        );
      }
      const err = validateLineRecognitionForApproval(line, i + 1);
      if (err) return NextResponse.json({ error: `Cannot approve: ${err}` }, { status: 422 });
    }

    const accountCodes = [...new Set(
      linesToValidate
        .flatMap((line) => [
          line.accountingAccountNumber,
          line.recognitionTreatment === "Prepaid" ? line.prepaidAccountNumber : null,
        ])
        .filter((code): code is string => Boolean(code?.trim()))
    )];
    const approvalAccounts = accountCodes.length > 0
      ? await db
          .select({
            code: chartOfAccounts.code,
            companyId: chartOfAccounts.companyId,
            type: chartOfAccounts.type,
            isActive: chartOfAccounts.isActive,
            isPosting: chartOfAccounts.isPosting,
          })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.companyId, existing.companyId),
              inArray(chartOfAccounts.code, accountCodes),
            )
          )
      : [];
    const approvalAccountsByCode = new Map(approvalAccounts.map((account) => [account.code, account]));

    for (let i = 0; i < linesToValidate.length; i++) {
      const err = validateLineAccountsForApproval(
        linesToValidate[i],
        i + 1,
        existing.companyId,
        approvalAccountsByCode,
      );
      if (err) return NextResponse.json({ error: `Cannot approve: ${err}` }, { status: 422 });
    }

    // Header totals must match sum of line totals (within tolerance).
    // Missing per-line VAT/gross is allowed; present-but-contradictory values are not.
    if (linesToValidate.length > 0) {
      const totalsResult = checkLineTotalsForApproval(
        linesToValidate,
        { net: finalNet, vat: finalVat, gross: finalGross },
        finalCurrencyType,
        finalLineNetAdjustment,
      );
      if (totalsResult !== "ok") {
        return NextResponse.json(
          { error: "Cannot approve: header totals do not match the sum of invoice lines." },
          { status: 422 }
        );
      }
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
  try {
    const result = await db.transaction(async (tx) => {
      let vendorId = data.vendorId !== undefined ? data.vendorId : existing.vendorId;
      let resolvedVendor: {
        id: number;
        name: string;
        taxId: string | null;
        normalizedTaxId: string | null;
        invoiceCount: number;
      } | null = null;

      if (data.newVendorName && !vendorId) {
        const companyVendors = await tx
          .select({
            id: vendors.id,
            name: vendors.name,
            taxId: vendors.taxId,
            normalizedTaxId: vendors.normalizedTaxId,
          })
          .from(vendors)
          .where(eq(vendors.companyId, existing.companyId));
        const match = findVendorIdentityMatches(data.newVendorName, data.newVendorTaxId, companyVendors);

        if (match.candidates.length > 1) {
          return { kind: "ambiguous" as const };
        }

        if (match.candidates.length === 1) {
          vendorId = match.candidates[0].id;
          resolvedVendor = { ...match.candidates[0], normalizedTaxId: match.candidates[0].normalizedTaxId ?? null, invoiceCount: 0 };
        } else {
          const displayTaxId = data.newVendorTaxId?.trim() || null;
          const normalizedTaxId = normalizeVendorTaxId(displayTaxId);
          const [created] = await tx
            .insert(vendors)
            .values({
              companyId: existing.companyId,
              name: data.newVendorName,
              taxId: displayTaxId,
              normalizedTaxId,
            })
            .onConflictDoNothing()
            .returning({
              id: vendors.id,
              name: vendors.name,
              taxId: vendors.taxId,
              normalizedTaxId: vendors.normalizedTaxId,
            });

          if (created) {
            vendorId = created.id;
            resolvedVendor = { ...created, invoiceCount: 0 };
          } else {
            const afterConflict = await tx
              .select({
                id: vendors.id,
                name: vendors.name,
                taxId: vendors.taxId,
                normalizedTaxId: vendors.normalizedTaxId,
              })
              .from(vendors)
              .where(eq(vendors.companyId, existing.companyId));
            const conflictMatch = findVendorIdentityMatches(data.newVendorName, displayTaxId, afterConflict);
            if (conflictMatch.candidates.length !== 1) {
              return { kind: "ambiguous" as const };
            }
            vendorId = conflictMatch.candidates[0].id;
            resolvedVendor = { ...conflictMatch.candidates[0], normalizedTaxId: conflictMatch.candidates[0].normalizedTaxId ?? null, invoiceCount: 0 };
          }
        }
      }

      if (vendorId && !resolvedVendor) {
        const [selectedVendor] = await tx
          .select({
            id: vendors.id,
            name: vendors.name,
            taxId: vendors.taxId,
            normalizedTaxId: vendors.normalizedTaxId,
          })
          .from(vendors)
          .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, existing.companyId)));
        if (selectedVendor) resolvedVendor = { ...selectedVendor, invoiceCount: 0 };
      }

      const updateValues = buildUpdateValues(
        data, normalizedNet, normalizedLineNetAdjustment, normalizedVat, normalizedGross,
        effectiveRate, finalNet, finalVat, finalGross, finalStatus, vendorId,
        currencyChanged
      );

      const [updated] = await tx
        .update(supplierInvoices)
        .set(updateValues)
        .where(and(
          eq(supplierInvoices.id, Number(id)),
          eq(supplierInvoices.companyId, activeCompany.id),
        ))
        .returning();

      if (!updated) return { kind: "not-found" as const };
      if (normalizedLines !== undefined) {
        await tx.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, existing.id));
        if (normalizedLines.length > 0) {
          await tx.insert(supplierInvoiceLines).values(
            normalizedLines.map((line, position) => ({ invoiceId: existing.id, position, ...line })),
          );
        }
      }

      return { kind: "updated" as const, invoice: updated, resolvedVendor };
    });

    if (result.kind === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.kind === "ambiguous") {
      return NextResponse.json(
        { error: "More than one vendor matches these details. Select the vendor to use before saving." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ...result.invoice, resolvedVendor: result.resolvedVendor });
  } catch {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}

function buildUpdateValues(
  data: z.infer<typeof UpdateSchema>,
  normalizedNet: string | null | undefined,
  normalizedLineNetAdjustment: string | undefined,
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
  if (normalizedLineNetAdjustment !== undefined) updateValues.lineNetAdjustment = normalizedLineNetAdjustment;
  if (normalizedVat !== undefined) updateValues.vatAmount = normalizedVat;
  if (normalizedGross !== undefined) updateValues.grossAmount = normalizedGross;

  // Always write rate when currency changed or rate was explicitly provided
  if (effectiveRate !== undefined || currencyChanged) {
    updateValues.fxRateToBase = effectiveRate ?? null;
  }

  if (data.costCentreId !== undefined) updateValues.costCentreId = data.costCentreId;
  if (data.expenseAccountId !== undefined) updateValues.expenseAccountId = data.expenseAccountId;
  if (data.notes !== undefined) updateValues.notes = data.notes;
  if (data.paymentStatus !== undefined) updateValues.paymentStatus = data.paymentStatus;
  if (data.paymentStatus === "Unpaid") {
    updateValues.paidDate = null;
  } else if (data.paidDate !== undefined) {
    updateValues.paidDate = data.paidDate;
  }

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  const activeCompany = await getActiveCompanyFromRequest(req);
  if (activeCompany instanceof Response) return activeCompany;
  const db = getDb();
  const outcome = await (async () => {
    try {
      return await db.transaction(async (tx) => {
        const [invoice] = await tx
          .select({ id: supplierInvoices.id, status: supplierInvoices.status })
          .from(supplierInvoices)
          .where(and(
            eq(supplierInvoices.id, invoiceId),
            eq(supplierInvoices.companyId, activeCompany.id),
          ));

        if (!invoice) return { kind: "not-found" as const, paths: [] as string[] };
        if (invoice.status !== "draft") return { kind: "approved" as const, paths: [] as string[] };

        const documents = await tx
          .select({ storagePath: supplierInvoiceDocuments.storagePath })
          .from(supplierInvoiceDocuments)
          .where(eq(supplierInvoiceDocuments.invoiceId, invoiceId));

        await tx.delete(supplierInvoiceLines).where(eq(supplierInvoiceLines.invoiceId, invoiceId));
        await tx.delete(supplierInvoiceDocuments).where(eq(supplierInvoiceDocuments.invoiceId, invoiceId));
        const [deleted] = await tx
          .delete(supplierInvoices)
          .where(and(
            eq(supplierInvoices.id, invoiceId),
            eq(supplierInvoices.companyId, activeCompany.id),
            eq(supplierInvoices.status, "draft"),
          ))
          .returning({ id: supplierInvoices.id });
        if (!deleted) throw new Error("Invoice status changed before deletion.");

        const exclusivePaths: string[] = [];
        for (const document of documents) {
          const [otherReference] = await tx
            .select({ id: supplierInvoiceDocuments.id })
            .from(supplierInvoiceDocuments)
            .where(eq(supplierInvoiceDocuments.storagePath, document.storagePath))
            .limit(1);
          if (!otherReference) exclusivePaths.push(document.storagePath);
        }
        return { kind: "deleted" as const, paths: exclusivePaths };
      });
    } catch {
      return null;
    }
  })();

  if (!outcome) return NextResponse.json({ error: "Invoice deletion failed. Please retry." }, { status: 500 });

  if (outcome.kind === "not-found") return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (outcome.kind === "approved") {
    return NextResponse.json({ error: "Approved invoices cannot be deleted." }, { status: 409 });
  }

  let fileWarning: string | undefined;
  for (const storagePath of outcome.paths) {
    try {
      await deleteDocument(storagePath);
    } catch (error) {
      fileWarning = error instanceof UnsafeDocumentStoragePathError
        ? "The invoice was deleted, but an unsafe document path was not removed."
        : "The invoice was deleted, but its uploaded file could not be removed.";
    }
  }

  return NextResponse.json({ deleted: true, warning: fileWarning });
}
