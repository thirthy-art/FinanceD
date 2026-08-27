import type { DisplayedReconciliationRun } from "./types";

type DisplayedRunImportPair = Pick<
  DisplayedReconciliationRun,
  "playerLedgerImportId" | "pspImportId"
>;

export function displayedRunPairLabel(run: DisplayedReconciliationRun): string {
  return `${run.playerLedgerFilename} + ${run.pspFilename}`;
}

export function isDisplayedRunCurrent(
  displayedRun: DisplayedRunImportPair | null,
  playerLedgerImportId: number | null,
  pspImportId: number | null
): boolean {
  return displayedRun !== null
    && playerLedgerImportId !== null
    && pspImportId !== null
    && displayedRun.playerLedgerImportId === playerLedgerImportId
    && displayedRun.pspImportId === pspImportId;
}

export function shouldShowStaleResultsWarning(
  displayedRun: DisplayedRunImportPair | null,
  playerLedgerImportId: number | null,
  pspImportId: number | null
): boolean {
  return displayedRun !== null
    && !isDisplayedRunCurrent(displayedRun, playerLedgerImportId, pspImportId);
}
