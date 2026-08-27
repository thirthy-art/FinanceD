import type { MatchStatus, ReconciliationSource } from "@/src/lib/reconciliation/types";

export interface UiTransaction {
  id: number;
  source: ReconciliationSource;
  externalId: string | null;
  playerId: string | null;
  reference: string | null;
  type: "deposit" | "withdrawal";
  amount: string;
  currency: string;
  eventDate: string | null;
  status: string | null;
  statusProvided: boolean;
  matchStatus: MatchStatus;
  linkedTransactionId: number | null;
}

export interface UiImport {
  id: number;
  source: ReconciliationSource;
  originalFilename: string;
  rowCount: number;
  createdAt: string;
}

export interface DisplayedReconciliationRun {
  id: number;
  playerLedgerImportId: number;
  pspImportId: number;
  playerLedgerFilename: string;
  pspFilename: string;
  updatedAt: string;
}
