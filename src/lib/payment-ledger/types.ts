export type AssetType = "fiat" | "crypto";
export type PaymentAccountType = "psp" | "wallet" | "exchange" | "bank" | "other";
export type PaymentEventType =
  | "deposit" | "withdrawal" | "refund" | "chargeback" | "fee" | "adjustment"
  | "settlement" | "transfer" | "reserve_hold" | "reserve_release" | "conversion" | "unknown";
export type BalanceDirection = "credit" | "debit" | "none";

export interface PaymentEvent {
  id: number;
  companyId: number;
  paymentAccountId: number;
  importId: number;
  sourceRowNumber: number;
  sourceRowId: string | null;
  externalId: string | null;
  reference: string | null;
  eventDate: string;
  eventType: PaymentEventType;
  balanceDirection: BalanceDirection;
  balanceAmount: string;
  balanceAssetCode: string;
  balanceAssetType: AssetType;
  sourceAmount: string | null;
  sourceAssetCode: string | null;
  sourceAssetType: AssetType | null;
  actualFeeAmount: string | null;
  actualFeeAssetCode: string | null;
  expectedFxRate: string | null;
  reportedAvailableBalance: string | null;
  reportedReserveBalance: string | null;
  expectedReleaseDate: string | null;
  destinationAccountId: number | null;
  destinationAmount: string | null;
  destinationAssetCode: string | null;
  destinationAssetType: AssetType | null;
  expectedDestinationAmount: string | null;
  expectedDestinationRate: string | null;
  relatedEventId: number | null;
  status: string | null;
  statusProvided: boolean;
  rawIdentifiers: string | null;
}

export interface AccountAssetOpening {
  paymentAccountId: number;
  assetCode: string;
  assetType: AssetType;
  openingAvailableBalance: string;
  openingReserveBalance: string;
}

export interface FeeRule {
  paymentAccountId: number;
  eventType: PaymentEventType;
  assetCode: string | null;
  percentageRate: string;
  fixedAmount: string;
  fixedAssetCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ReserveRule {
  paymentAccountId: number;
  assetCode: string | null;
  holdPeriodDays: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}
