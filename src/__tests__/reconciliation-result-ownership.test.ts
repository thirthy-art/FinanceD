import { describe, expect, it } from "vitest";
import {
  displayedRunPairLabel,
  isDisplayedRunCurrent,
  shouldShowStaleResultsWarning,
} from "../../app/reconciliation/result-ownership";
import type { DisplayedReconciliationRun } from "../../app/reconciliation/types";

const displayedRun: DisplayedReconciliationRun = {
  id: 91,
  playerLedgerImportId: 11,
  pspImportId: 22,
  playerLedgerFilename: "ledger-2026-08-27.csv",
  pspFilename: "psp-2026-08-27.xlsx",
  updatedAt: "2026-08-27T09:30:00.000Z",
};

describe("reconciliation result ownership", () => {
  it("identifies the exact import pair represented by the displayed run", () => {
    expect(displayedRunPairLabel(displayedRun)).toBe(
      "ledger-2026-08-27.csv + psp-2026-08-27.xlsx"
    );
  });

  it("treats the displayed results as current only for the exact selected pair", () => {
    expect(isDisplayedRunCurrent(displayedRun, 11, 22)).toBe(true);
    expect(shouldShowStaleResultsWarning(displayedRun, 11, 22)).toBe(false);
  });

  it("warns when either selected import differs from the displayed run", () => {
    expect(shouldShowStaleResultsWarning(displayedRun, 12, 22)).toBe(true);
    expect(shouldShowStaleResultsWarning(displayedRun, 11, 23)).toBe(true);
  });

  it("warns after an upload selects a newer import until that pair is run", () => {
    const newlyUploadedLedgerImportId = 12;
    expect(
      shouldShowStaleResultsWarning(displayedRun, newlyUploadedLedgerImportId, 22)
    ).toBe(true);
  });

  it("does not show result ownership or a stale warning without a completed run", () => {
    expect(isDisplayedRunCurrent(null, 11, 22)).toBe(false);
    expect(shouldShowStaleResultsWarning(null, 11, 22)).toBe(false);
  });
});
