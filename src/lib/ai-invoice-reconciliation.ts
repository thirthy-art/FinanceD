import { Decimal, BASE_ROUNDING } from "./decimal";
import type { AiInvoiceExtraction } from "./ai-extraction";

export type AiInvoiceReconciliationKind =
  | "matched"
  | "vat-prorated"
  | "gross-reclassified"
  | "minor-difference"
  | "review-required"
  | "not-applicable";

export interface AiInvoiceReconciliationInfo {
  kind: AiInvoiceReconciliationKind;
  netDifference?: string | null;
  vatDifference?: string | null;
  grossDifference?: string | null;
}

const FIAT_TOLERANCE = new Decimal("0.01");
const MINOR_DIFF_THRESHOLD = new Decimal("1.00");

function tryParseDec(v: string | null): Decimal | null {
  if (v === null) return null;
  try {
    return new Decimal(v);
  } catch {
    return null;
  }
}

function isUsable(v: string | null): v is string {
  if (v === null) return false;
  try {
    new Decimal(v);
    return true;
  } catch {
    return false;
  }
}

// null is not-zero; "0" and "0.00" are zero. Together they are both "absent".
function isNullOrZero(v: string | null): boolean {
  if (v === null) return true;
  const d = tryParseDec(v);
  return d !== null && d.isZero();
}

function withinFiatTolerance(a: Decimal, b: Decimal): boolean {
  return a.minus(b).abs().lte(FIAT_TOLERANCE);
}

// Returns true when more than one distinct non-null VAT rate appears across lines.
function hasConflictingVatRates(lines: AiInvoiceExtraction["lines"]): boolean {
  const nonNullRates = lines
    .map((l) => l.vatRate)
    .filter((r): r is string => r !== null);

  if (nonNullRates.length === 0) return false;

  const distinct = new Set(
    nonNullRates.map((r) => {
      try {
        return new Decimal(r).toFixed();
      } catch {
        return r;
      }
    }),
  );

  return distinct.size > 1;
}

// Returns header decimals only when all three are present AND header reconciles.
function parseValidHeader(extraction: AiInvoiceExtraction): {
  net: Decimal;
  vat: Decimal;
  gross: Decimal;
} | null {
  const net = tryParseDec(extraction.netAmount);
  const vat = tryParseDec(extraction.vatAmount);
  const gross = tryParseDec(extraction.grossAmount);

  if (net === null || vat === null || gross === null) return null;
  if (!withinFiatTolerance(net.plus(vat), gross)) return null;

  return { net, vat, gross };
}

export function reconcileAiInvoiceExtraction(
  extraction: AiInvoiceExtraction,
  currencyType: "fiat" | "crypto",
): {
  extraction: AiInvoiceExtraction;
  reconciliation: AiInvoiceReconciliationInfo;
} {
  if (currencyType !== "fiat") {
    return { extraction, reconciliation: { kind: "not-applicable" } };
  }

  const header = parseValidHeader(extraction);
  if (header === null) {
    return { extraction, reconciliation: { kind: "review-required" } };
  }

  const { net: headerNet, vat: headerVat, gross: headerGross } = header;
  const lines = extraction.lines;

  // No lines → header is self-consistent and there is nothing to transform.
  if (lines.length === 0) {
    return { extraction, reconciliation: { kind: "matched" } };
  }

  // Pre-compute which fields have complete (all-lines) usable data.
  const allNets = lines.every((l) => isUsable(l.netAmount));
  const allVats = lines.every((l) => isUsable(l.vatAmount));
  const allGrosses = lines.every((l) => isUsable(l.grossAmount));

  // "Absent" means every line has null or zero for both vat AND gross.
  // When absent, Cases 2/3 are candidates; when NOT absent, Case 1 is a candidate.
  const allVatGrossAbsent = lines.every(
    (l) => isNullOrZero(l.vatAmount) && isNullOrZero(l.grossAmount),
  );

  const sumNets = allNets
    ? lines.reduce((s, l) => s.plus(new Decimal(l.netAmount!)), new Decimal(0))
    : null;
  const sumVats = allVats
    ? lines.reduce((s, l) => s.plus(new Decimal(l.vatAmount!)), new Decimal(0))
    : null;
  const sumGrosses = allGrosses
    ? lines.reduce((s, l) => s.plus(new Decimal(l.grossAmount!)), new Decimal(0))
    : null;

  // ── Case 1: Already reconciled ─────────────────────────────────────────────
  // Only fire when lines already carry vat or gross data (otherwise Cases 2/3 apply).
  if (!allVatGrossAbsent) {
    const netOk = sumNets === null || withinFiatTolerance(sumNets, headerNet);
    const vatOk = sumVats === null || withinFiatTolerance(sumVats, headerVat);
    const grossOk = sumGrosses === null || withinFiatTolerance(sumGrosses, headerGross);
    const anyData = sumNets !== null || sumVats !== null || sumGrosses !== null;

    if (anyData && netOk && vatOk && grossOk) {
      return { extraction, reconciliation: { kind: "matched" } };
    }
  }

  // ── Case 2: Header-only VAT → prorate proportionally across line nets ──────
  // Eligibility (all must hold):
  //   1. valid header (above)          2. ≥ 2 lines
  //   3. all lines have usable net     4. Σ line net ≈ header net
  //   5. header net ≠ 0               6. all line vat null/zero
  //   7. all line gross null/zero     8. no conflicting per-line VAT rates
  if (
    lines.length >= 2 &&
    allNets &&
    sumNets !== null &&
    withinFiatTolerance(sumNets, headerNet) &&
    !headerNet.isZero() &&
    allVatGrossAbsent &&
    !hasConflictingVatRates(lines)
  ) {
    const newLines = lines.map((l) => ({ ...l }));
    let allocatedVatSum = new Decimal(0);

    for (let i = 0; i < newLines.length - 1; i++) {
      const lineNet = new Decimal(newLines[i].netAmount!);
      const allocatedVat = headerVat
        .times(lineNet)
        .div(headerNet)
        .toDecimalPlaces(2, BASE_ROUNDING);
      newLines[i] = {
        ...newLines[i],
        vatAmount: allocatedVat.toFixed(2),
        grossAmount: lineNet.plus(allocatedVat).toFixed(2),
      };
      allocatedVatSum = allocatedVatSum.plus(allocatedVat);
    }

    // Final line receives the exact residual so Σ VAT = header VAT exactly.
    const lastIdx = newLines.length - 1;
    const lastNet = new Decimal(newLines[lastIdx].netAmount!);
    const lastVat = headerVat.minus(allocatedVatSum);
    newLines[lastIdx] = {
      ...newLines[lastIdx],
      vatAmount: lastVat.toFixed(2),
      grossAmount: lastNet.plus(lastVat).toFixed(2),
    };

    return {
      extraction: { ...extraction, lines: newLines },
      reconciliation: { kind: "vat-prorated" },
    };
  }

  // ── Case 3: Extracted "net" amounts are actually VAT-inclusive gross ────────
  // Eligibility (all must hold):
  //   1. valid header (above)          2. all lines have usable net
  //   3. Σ line net ≠ header net       4. Σ line net ≈ header gross
  //   5. header gross ≠ 0             6. all line gross null/zero
  //   7. all line vat null/zero       8. no conflicting per-line VAT rates
  if (
    allNets &&
    sumNets !== null &&
    !withinFiatTolerance(sumNets, headerNet) &&
    withinFiatTolerance(sumNets, headerGross) &&
    !headerGross.isZero() &&
    allVatGrossAbsent &&
    !hasConflictingVatRates(lines)
  ) {
    const newLines = lines.map((l) => ({ ...l }));
    let allocatedNetSum = new Decimal(0);

    for (let i = 0; i < newLines.length - 1; i++) {
      // The AI-extracted "netAmount" is actually the line's gross.
      const lineGross = new Decimal(newLines[i].netAmount!);
      const lineNet = lineGross
        .times(headerNet)
        .div(headerGross)
        .toDecimalPlaces(2, BASE_ROUNDING);
      const lineVat = lineGross.minus(lineNet);
      newLines[i] = {
        ...newLines[i],
        netAmount: lineNet.toFixed(2),
        vatAmount: lineVat.toFixed(2),
        grossAmount: lineGross.toFixed(2),
      };
      allocatedNetSum = allocatedNetSum.plus(lineNet);
    }

    // Final line: net is the residual so Σ net = header net exactly.
    const lastIdx = newLines.length - 1;
    const lastGross = new Decimal(newLines[lastIdx].netAmount!);
    const lastNet = headerNet.minus(allocatedNetSum);
    const lastVat = lastGross.minus(lastNet);
    newLines[lastIdx] = {
      ...newLines[lastIdx],
      netAmount: lastNet.toFixed(2),
      vatAmount: lastVat.toFixed(2),
      grossAmount: lastGross.toFixed(2),
    };

    // Revalidate: if the transformation produced inconsistent totals, discard it.
    const reNets = newLines.reduce(
      (s, l) => s.plus(new Decimal(l.netAmount!)),
      new Decimal(0),
    );
    const reVats = newLines.reduce(
      (s, l) => s.plus(new Decimal(l.vatAmount!)),
      new Decimal(0),
    );
    const reGrosses = newLines.reduce(
      (s, l) => s.plus(new Decimal(l.grossAmount!)),
      new Decimal(0),
    );

    if (
      withinFiatTolerance(reNets, headerNet) &&
      withinFiatTolerance(reVats, headerVat) &&
      withinFiatTolerance(reGrosses, headerGross)
    ) {
      return {
        extraction: { ...extraction, lines: newLines },
        reconciliation: { kind: "gross-reclassified" },
      };
    }

    // Transformation did not reconcile — return unchanged with review-required.
    return { extraction, reconciliation: { kind: "review-required" } };
  }

  // ── Case 4: Minor difference (< 1.00 but > 0.01) ──────────────────────────
  // sign convention: difference = sum(lines) - header
  const netDiff = sumNets ? sumNets.minus(headerNet) : null;
  const vatDiff = sumVats ? sumVats.minus(headerVat) : null;
  const grossDiff = sumGrosses ? sumGrosses.minus(headerGross) : null;

  const computedDiffs = [netDiff, vatDiff, grossDiff].filter(
    (d): d is Decimal => d !== null,
  );

  if (computedDiffs.length > 0) {
    const allMinor = computedDiffs.every((d) => d.abs().lt(MINOR_DIFF_THRESHOLD));
    const anyNonTrivial = computedDiffs.some((d) => d.abs().gt(FIAT_TOLERANCE));

    if (allMinor && anyNonTrivial) {
      return {
        extraction,
        reconciliation: {
          kind: "minor-difference",
          netDifference: netDiff ? netDiff.toFixed(2) : null,
          vatDifference: vatDiff ? vatDiff.toFixed(2) : null,
          grossDifference: grossDiff ? grossDiff.toFixed(2) : null,
        },
      };
    }
  }

  // ── Case 5: Unresolved mismatch ────────────────────────────────────────────
  return { extraction, reconciliation: { kind: "review-required" } };
}
