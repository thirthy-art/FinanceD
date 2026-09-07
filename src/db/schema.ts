import {
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
  pgEnum,
  unique,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "approved",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const recognitionTreatmentEnum = pgEnum("recognition_treatment", [
  "Immediate",
  "Prepaid",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "Unpaid",
  "Paid",
]);

export const currencyTypeEnum = pgEnum("currency_type", [
  "fiat",
  "crypto",
]);

export const reconciliationSourceEnum = pgEnum("reconciliation_source", [
  "player_ledger",
  "psp_transactions",
]);

export const reconciliationTransactionTypeEnum = pgEnum("reconciliation_transaction_type", [
  "deposit",
  "withdrawal",
]);

export const reconciliationMatchStatusEnum = pgEnum("reconciliation_match_status", [
  "matched",
  "unmatched",
  "ambiguous",
]);

export const paymentAccountTypeEnum = pgEnum("payment_account_type", [
  "psp", "wallet", "exchange", "bank", "other",
]);

export const paymentEventTypeEnum = pgEnum("payment_event_type", [
  "deposit", "withdrawal", "refund", "chargeback", "fee", "adjustment",
  "settlement", "transfer", "reserve_hold", "reserve_release", "conversion", "unknown",
]);

export const paymentBalanceDirectionEnum = pgEnum("payment_balance_direction", [
  "credit", "debit", "none",
]);

export const paymentIngestionSourceEnum = pgEnum("payment_ingestion_source", [
  "csv", "xlsx", "api", "manual",
]);

export const paymentFeeBasisEnum = pgEnum("payment_fee_basis", [
  "source_amount", "balance_amount",
]);

export const vendorStatusEnum = pgEnum("vendor_status", [
  "draft",
  "active",
]);

export const cashForecastDirectionEnum = pgEnum("cash_forecast_direction", [
  "inflow",
  "outflow",
]);

export const cashForecastCategoryEnum = pgEnum("cash_forecast_category", [
  "customer_receipts",
  "financing_inflow",
  "other_inflow",
  "payroll",
  "tax_vat",
  "rent",
  "debt_service",
  "other_outflow",
]);

// ─── Companies ────────────────────────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  baseCurrency: varchar("base_currency", { length: 10 }).notNull().default("EUR"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Deployment-global AI Settings ───────────────────────────────────────────────

export const aiSettings = pgTable("ai_settings", {
  id: integer("id").primaryKey().default(1),
  mimoModel: varchar("mimo_model", { length: 200 }),
  mimoApiKeyEncrypted: text("mimo_api_key_encrypted"),
  openrouterApiKeyEncrypted: text("openrouter_api_key_encrypted"),
  openrouterFallback1Model: varchar("openrouter_fallback_1_model", { length: 200 })
    .notNull()
    .default("xiaomi/mimo-v2.5"),
  openrouterFallback2Model: varchar("openrouter_fallback_2_model", { length: 200 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  singleton: check("ck_ai_settings_singleton", sql`${table.id} = 1`),
}));

// ─── Chart of Accounts ────────────────────────────────────────────────────────

export const chartOfAccounts = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: accountTypeEnum("type").notNull(),
  parentId: integer("parent_id").references((): AnyPgColumn => chartOfAccounts.id),
  isPosting: boolean("is_posting").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyCodeUnique: unique("uq_coa_company_code").on(table.companyId, table.code),
}));

// ─── Cost Centres ─────────────────────────────────────────────────────────────

export const costCentres = pgTable("cost_centres", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyCodeUnique: unique("uq_cc_company_code").on(table.companyId, table.code),
}));

// ─── Vendors ──────────────────────────────────────────────────────────────────

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  taxId: varchar("tax_id", { length: 50 }),
  normalizedTaxId: varchar("normalized_tax_id", { length: 50 }),
  address: text("address"),
  defaultCurrency: varchar("default_currency", { length: 10 }),
  externalVendorNumber: varchar("external_vendor_number", { length: 100 }),
  vendorStatus: vendorStatusEnum("vendor_status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyNormalizedTaxIdUnique: uniqueIndex("uq_vendors_company_normalized_tax_id")
    .on(table.companyId, table.normalizedTaxId)
    .where(sql`${table.normalizedTaxId} is not null`),
}));

// ─── Supplier Invoices ────────────────────────────────────────────────────────

export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
  uploadRequestId: varchar("upload_request_id", { length: 100 }).unique(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  invoiceNumber: varchar("invoice_number", { length: 100 }),
  invoiceDate: varchar("invoice_date", { length: 10 }),
  dueDate: varchar("due_date", { length: 10 }),
  currency: varchar("currency", { length: 20 }).notNull().default("EUR"),
  currencyType: currencyTypeEnum("currency_type").notNull().default("fiat"),
  fxRateToBase: numeric("fx_rate_to_base", { precision: 38, scale: 18 }),
  netAmount: numeric("net_amount", { precision: 38, scale: 18 }),
  lineNetAdjustment: numeric("line_net_adjustment", { precision: 38, scale: 18 }).notNull().default("0"),
  vatAmount: numeric("vat_amount", { precision: 38, scale: 18 }),
  grossAmount: numeric("gross_amount", { precision: 38, scale: 18 }),
  baseNetAmount: numeric("base_net_amount", { precision: 18, scale: 4 }),
  baseVatAmount: numeric("base_vat_amount", { precision: 18, scale: 4 }),
  baseGrossAmount: numeric("base_gross_amount", { precision: 18, scale: 4 }),
  costCentreId: integer("cost_centre_id").references(() => costCentres.id),
  expenseAccountId: integer("expense_account_id").references(
    () => chartOfAccounts.id
  ),
  notes: text("notes"),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("Unpaid"),
  paidDate: varchar("paid_date", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Supplier Invoice Documents ───────────────────────────────────────────────

export const supplierInvoiceDocuments = pgTable("supplier_invoice_documents", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => supplierInvoices.id),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  storagePath: varchar("storage_path", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  extractedText: text("extracted_text"),
  ocrPerformed: boolean("ocr_performed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => supplierInvoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  lineNumber: varchar("line_number", { length: 100 }),
  descriptionOriginal: text("description_original"),
  description: text("description"),
  quantity: numeric("quantity", { precision: 38, scale: 18 }),
  unit: varchar("unit", { length: 100 }),
  unitPrice: numeric("unit_price", { precision: 38, scale: 18 }),
  netAmount: numeric("net_amount", { precision: 38, scale: 18 }),
  vatRate: numeric("vat_rate", { precision: 38, scale: 18 }),
  vatAmount: numeric("vat_amount", { precision: 38, scale: 18 }),
  grossAmount: numeric("gross_amount", { precision: 38, scale: 18 }),
  sourcePage: integer("source_page"),
  recognitionTreatment: recognitionTreatmentEnum("recognition_treatment").notNull().default("Immediate"),
  recognitionStartDate: varchar("recognition_start_date", { length: 10 }),
  recognitionEndDate: varchar("recognition_end_date", { length: 10 }),
  accountingAccountNumber: varchar("accounting_account_number", { length: 50 }),
  prepaidAccountNumber: varchar("prepaid_account_number", { length: 50 }),
  netAmountDerived: boolean("net_amount_derived").notNull().default(false),
  vatAmountDerived: boolean("vat_amount_derived").notNull().default(false),
  grossAmountDerived: boolean("gross_amount_derived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  invoicePositionUnique: unique("uq_invoice_line_position").on(table.invoiceId, table.position),
}));

// ─── Budget Categories ────────────────────────────────────────────────────────

export const budgetCategories = pgTable("budget_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyNameUnique: unique("uq_budget_category_company_name").on(table.companyId, table.name),
}));

// Maps expense posting accounts to budget categories (1 account → at most 1 category)
export const budgetCategoryAccounts = pgTable("budget_category_accounts", {
  id: serial("id").primaryKey(),
  budgetCategoryId: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => chartOfAccounts.id),
}, (table) => ({
  accountUnique: unique("uq_budget_category_account").on(table.accountId),
}));

// Budgeted amounts per category/month/optional cost centre
export const budgetEntries = pgTable("budget_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  budgetCategoryId: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id),
  month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
  costCentreId: integer("cost_centre_id").references(() => costCentres.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  noCcUnique: uniqueIndex("uq_budget_entry_no_cc")
    .on(table.companyId, table.budgetCategoryId, table.month)
    .where(sql`${table.costCentreId} is null`),
  withCcUnique: uniqueIndex("uq_budget_entry_with_cc")
    .on(table.companyId, table.budgetCategoryId, table.month, table.costCentreId)
    .where(sql`${table.costCentreId} is not null`),
}));

// Manual actual entries (salaries, depreciation, journals not in AP)
export const budgetActualEntries = pgTable("budget_actual_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  budgetCategoryId: integer("budget_category_id")
    .notNull()
    .references(() => budgetCategories.id),
  month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
  costCentreId: integer("cost_centre_id").references(() => costCentres.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: varchar("description", { length: 500 }),
  source: varchar("source", { length: 100 }).notNull().default("Manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── 13-week Cash Forecast ───────────────────────────────────────────────────

export const cashForecastSettings = pgTable("cash_forecast_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  openingCashBalance: numeric("opening_cash_balance", { precision: 18, scale: 4 }).notNull().default("0"),
  minimumCashBuffer: numeric("minimum_cash_buffer", { precision: 18, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyUnique: unique("uq_cash_forecast_settings_company").on(table.companyId),
  minimumBufferNonnegative: check(
    "cash_forecast_settings_minimum_buffer_nonnegative",
    sql`${table.minimumCashBuffer} >= 0`
  ),
}));

export const cashForecastItems = pgTable("cash_forecast_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  date: varchar("date", { length: 10 }).notNull(),
  description: varchar("description", { length: 200 }).notNull(),
  direction: cashForecastDirectionEnum("direction").notNull(),
  category: cashForecastCategoryEnum("category").notNull(),
  amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  amountNonnegative: check("cash_forecast_item_amount_nonnegative", sql`${table.amount} >= 0`),
}));

// ─── Client Funds Reconciliation ──────────────────────────────────────────────
//
// Deterministic client-funds / PSP reconciliation foundation.
// Imports are persisted per-company so duplicate uploads are rejected and
// imported source transactions stay independently identifiable. This module is
// intentionally NOT connected to supplier invoice or payment semantics.

export const paymentAccounts = pgTable("payment_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  providerName: varchar("provider_name", { length: 255 }),
  accountType: paymentAccountTypeEnum("account_type").notNull(),
  clientFundsEligible: boolean("client_funds_eligible").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyNameUnique: unique("uq_payment_account_company_name").on(table.companyId, table.name),
}));

export const paymentAccountAssets = pgTable("payment_account_assets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  paymentAccountId: integer("payment_account_id").notNull().references(() => paymentAccounts.id),
  assetCode: varchar("asset_code", { length: 20 }).notNull(),
  assetType: currencyTypeEnum("asset_type").notNull(),
  openingAvailableBalance: numeric("opening_available_balance", { precision: 38, scale: 18 }).notNull().default("0"),
  openingReserveBalance: numeric("opening_reserve_balance", { precision: 38, scale: 18 }).notNull().default("0"),
  openingBalanceDate: varchar("opening_balance_date", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  accountAssetUnique: unique("uq_payment_account_asset").on(table.paymentAccountId, table.assetCode),
}));

export const paymentFeeRules = pgTable("payment_fee_rules", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  paymentAccountId: integer("payment_account_id").notNull().references(() => paymentAccounts.id),
  eventType: paymentEventTypeEnum("event_type").notNull(),
  feeBasis: paymentFeeBasisEnum("fee_basis").notNull().default("source_amount"),
  assetCode: varchar("asset_code", { length: 20 }),
  feeAssetCode: varchar("fee_asset_code", { length: 20 }),
  percentageRate: numeric("percentage_rate", { precision: 38, scale: 18 }).notNull().default("0"),
  fixedAmount: numeric("fixed_amount", { precision: 38, scale: 18 }).notNull().default("0"),
  fixedAssetCode: varchar("fixed_asset_code", { length: 20 }),
  effectiveFrom: varchar("effective_from", { length: 10 }).notNull(),
  effectiveTo: varchar("effective_to", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  nonnegativeRates: check("payment_fee_rule_nonnegative", sql`${table.percentageRate} >= 0 and ${table.fixedAmount} >= 0`),
}));

export const paymentReserveRules = pgTable("payment_reserve_rules", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  paymentAccountId: integer("payment_account_id").notNull().references(() => paymentAccounts.id),
  assetCode: varchar("asset_code", { length: 20 }),
  reservePercentage: numeric("reserve_percentage", { precision: 38, scale: 18 }),
  holdPeriodDays: integer("hold_period_days"),
  effectiveFrom: varchar("effective_from", { length: 10 }).notNull(),
  effectiveTo: varchar("effective_to", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  validValues: check("payment_reserve_rule_valid", sql`(${table.reservePercentage} is null or ${table.reservePercentage} >= 0) and (${table.holdPeriodDays} is null or ${table.holdPeriodDays} >= 0)`),
}));

export const reconciliationImports = pgTable("reconciliation_imports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  sourceKind: reconciliationSourceEnum("source_kind").notNull(),
  paymentAccountId: integer("payment_account_id").references(() => paymentAccounts.id),
  ingestionSource: paymentIngestionSourceEnum("ingestion_source"),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  rowCount: integer("row_count").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("parsed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  legacyCompanySourceHashUnique: uniqueIndex("uq_reconciliation_import_legacy_hash")
    .on(table.companyId, table.sourceKind, table.contentHash)
    .where(sql`${table.paymentAccountId} is null`),
  accountSourceHashUnique: uniqueIndex("uq_reconciliation_import_account_hash")
    .on(table.companyId, table.sourceKind, table.paymentAccountId, table.contentHash)
    .where(sql`${table.paymentAccountId} is not null`),
}));

/** Canonical source facts for every new PSP/wallet/payment-account import. */
export const paymentEvents = pgTable("payment_events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  paymentAccountId: integer("payment_account_id").notNull().references(() => paymentAccounts.id),
  importId: integer("import_id").notNull().references(() => reconciliationImports.id),
  sourceRowNumber: integer("source_row_number").notNull(),
  sourceRowId: varchar("source_row_id", { length: 255 }),
  providerEventId: varchar("provider_event_id", { length: 255 }),
  relatedProviderEventId: varchar("related_provider_event_id", { length: 255 }),
  relatedPaymentAccountId: integer("related_payment_account_id").references(() => paymentAccounts.id),
  externalId: varchar("external_id", { length: 255 }),
  reference: text("reference"),
  eventDate: varchar("event_date", { length: 10 }).notNull(),
  eventType: paymentEventTypeEnum("event_type").notNull(),
  balanceDirection: paymentBalanceDirectionEnum("balance_direction").notNull(),
  balanceAmount: numeric("balance_amount", { precision: 38, scale: 18 }).notNull(),
  balanceAssetCode: varchar("balance_asset_code", { length: 20 }).notNull(),
  balanceAssetType: currencyTypeEnum("balance_asset_type").notNull(),
  sourceAmount: numeric("source_amount", { precision: 38, scale: 18 }),
  sourceAssetCode: varchar("source_asset_code", { length: 20 }),
  sourceAssetType: currencyTypeEnum("source_asset_type"),
  actualFeeAmount: numeric("actual_fee_amount", { precision: 38, scale: 18 }),
  actualFeeAssetCode: varchar("actual_fee_asset_code", { length: 20 }),
  expectedFxRate: numeric("expected_fx_rate", { precision: 38, scale: 18 }),
  reportedAvailableBalance: numeric("reported_available_balance", { precision: 38, scale: 18 }),
  reportedReserveBalance: numeric("reported_reserve_balance", { precision: 38, scale: 18 }),
  expectedReleaseDate: varchar("expected_release_date", { length: 10 }),
  destinationAccountId: integer("destination_account_id").references(() => paymentAccounts.id),
  destinationAmount: numeric("destination_amount", { precision: 38, scale: 18 }),
  destinationAssetCode: varchar("destination_asset_code", { length: 20 }),
  destinationAssetType: currencyTypeEnum("destination_asset_type"),
  expectedDestinationAmount: numeric("expected_destination_amount", { precision: 38, scale: 18 }),
  expectedDestinationRate: numeric("expected_destination_rate", { precision: 38, scale: 18 }),
  relatedEventId: integer("related_event_id").references((): AnyPgColumn => paymentEvents.id),
  finalReceipt: boolean("final_receipt").notNull().default(false),
  status: varchar("status", { length: 50 }),
  statusProvided: boolean("status_provided").notNull().default(false),
  rawIdentifiers: text("raw_identifiers"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  importRowUnique: unique("uq_payment_event_import_row").on(table.importId, table.sourceRowNumber),
  providerEventUnique: uniqueIndex("uq_payment_event_account_provider_id")
    .on(table.companyId, table.paymentAccountId, table.providerEventId)
    .where(sql`${table.providerEventId} is not null`),
  magnitudeNonnegative: check("payment_event_magnitude_nonnegative", sql`${table.balanceAmount} >= 0`),
  sourceNonnegative: check("payment_event_source_nonnegative", sql`${table.sourceAmount} is null or ${table.sourceAmount} >= 0`),
  feeNonnegative: check("payment_event_fee_nonnegative", sql`${table.actualFeeAmount} is null or ${table.actualFeeAmount} >= 0`),
}));

/** Additive membership: canonical events may be represented by multiple overlapping imports. */
export const paymentImportEvents = pgTable("payment_import_events", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  importId: integer("import_id").notNull().references(() => reconciliationImports.id),
  paymentEventId: integer("payment_event_id").notNull().references(() => paymentEvents.id),
  sourceRowNumber: integer("source_row_number").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  importEventUnique: unique("uq_payment_import_event").on(table.importId, table.paymentEventId),
  importRowUnique: unique("uq_payment_import_source_row").on(table.importId, table.sourceRowNumber),
}));

/** Provider-reported source facts. Calculated balances are never persisted here. */
export const paymentBalanceSnapshots = pgTable("payment_balance_snapshots", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  paymentAccountId: integer("payment_account_id").notNull().references(() => paymentAccounts.id),
  assetCode: varchar("asset_code", { length: 20 }).notNull(),
  assetType: currencyTypeEnum("asset_type").notNull(),
  reportedAvailableBalance: numeric("reported_available_balance", { precision: 38, scale: 18 }).notNull(),
  reportedReserveBalance: numeric("reported_reserve_balance", { precision: 38, scale: 18 }),
  asOf: timestamp("as_of").notNull(),
  ingestionSource: paymentIngestionSourceEnum("ingestion_source").notNull(),
  providerSnapshotId: varchar("provider_snapshot_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  providerSnapshotUnique: uniqueIndex("uq_payment_balance_snapshot_provider_id")
    .on(table.companyId, table.paymentAccountId, table.assetCode, table.providerSnapshotId)
    .where(sql`${table.providerSnapshotId} is not null`),
}));

// One deterministic run owns exactly one player-ledger import and one PSP
// import. Reusing the same pair returns the same run and recomputes its result.
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  playerLedgerImportId: integer("player_ledger_import_id")
    .notNull()
    .references(() => reconciliationImports.id),
  pspImportId: integer("psp_import_id")
    .notNull()
    .references(() => reconciliationImports.id),
  status: varchar("status", { length: 20 }).notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  importPairUnique: unique("uq_reconciliation_run_company_import_pair").on(
    table.companyId,
    table.playerLedgerImportId,
    table.pspImportId
  ),
}));

export const reconciliationTransactions = pgTable("reconciliation_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  importId: integer("import_id")
    .notNull()
    .references(() => reconciliationImports.id),
  source: reconciliationSourceEnum("source").notNull(),
  externalId: varchar("external_id", { length: 255 }),
  playerId: varchar("player_id", { length: 255 }),
  transactionType: reconciliationTransactionTypeEnum("transaction_type").notNull(),
  amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
  currency: varchar("currency", { length: 20 }).notNull(),
  eventDate: varchar("event_date", { length: 10 }),
  reference: text("reference"),
  status: varchar("status", { length: 50 }),
  statusProvided: boolean("status_provided").notNull().default(false),
  matchStatus: reconciliationMatchStatusEnum("match_status")
    .notNull()
    .default("unmatched"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  amountNonnegative: check(
    "reconciliation_transaction_amount_nonnegative",
    sql`${table.amount} >= 0`
  ),
}));

// Match status is scoped to a run because one persisted import can be paired
// with different counterpart imports over time.
export const reconciliationRunItems = pgTable("reconciliation_run_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id),
  transactionId: integer("transaction_id")
    .notNull()
    .references(() => reconciliationTransactions.id),
  matchStatus: reconciliationMatchStatusEnum("match_status")
    .notNull()
    .default("unmatched"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  runTransactionUnique: unique("uq_reconciliation_run_item").on(
    table.runId,
    table.transactionId
  ),
}));

// A match binds exactly one player-ledger transaction to exactly one PSP
// transaction for the same company. The v1 engine only creates one-to-one
// exact matches; the shape intentionally leaves room (without implementing
// them) for one-to-many / many-to-one and manual-confirmation workflows later.
export const reconciliationMatches = pgTable("reconciliation_matches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id),
  playerTransactionId: integer("player_transaction_id")
    .notNull()
    .references(() => reconciliationTransactions.id),
  pspTransactionId: integer("psp_transaction_id")
    .notNull()
    .references(() => reconciliationTransactions.id),
  matchReason: varchar("match_reason", { length: 255 }).notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  playerUnique: unique(
    "match_player_transaction_unique"
  ).on(table.runId, table.playerTransactionId),
  pspUnique: unique(
    "match_psp_transaction_unique"
  ).on(table.runId, table.pspTransactionId),
  playerPspUnique: uniqueIndex("match_player_psp_unique")
    .on(table.runId, table.playerTransactionId, table.pspTransactionId),
}));

/** Additive adapter state for runs against canonical payment events. */
export const reconciliationPaymentRunItems = pgTable("reconciliation_payment_run_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  runId: integer("run_id").notNull().references(() => reconciliationRuns.id),
  paymentEventId: integer("payment_event_id").notNull().references(() => paymentEvents.id),
  matchStatus: reconciliationMatchStatusEnum("match_status").notNull().default("unmatched"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  runEventUnique: unique("uq_reconciliation_payment_run_item").on(table.runId, table.paymentEventId),
}));

export const reconciliationPaymentMatches = pgTable("reconciliation_payment_matches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  runId: integer("run_id").notNull().references(() => reconciliationRuns.id),
  playerTransactionId: integer("player_transaction_id").notNull().references(() => reconciliationTransactions.id),
  paymentEventId: integer("payment_event_id").notNull().references(() => paymentEvents.id),
  matchReason: varchar("match_reason", { length: 255 }).notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  playerUnique: unique("payment_match_player_unique").on(table.runId, table.playerTransactionId),
  eventUnique: unique("payment_match_event_unique").on(table.runId, table.paymentEventId),
}));

// ─── Relations ────────────────────────────────────────────────────────────────

export const reconciliationImportRelations = relations(
  reconciliationImports,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [reconciliationImports.companyId],
      references: [companies.id],
    }),
    transactions: many(reconciliationTransactions),
    playerLedgerRuns: many(reconciliationRuns, { relationName: "playerLedgerImport" }),
    pspRuns: many(reconciliationRuns, { relationName: "pspImport" }),
  })
);

export const reconciliationRunRelations = relations(
  reconciliationRuns,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [reconciliationRuns.companyId],
      references: [companies.id],
    }),
    playerLedgerImport: one(reconciliationImports, {
      fields: [reconciliationRuns.playerLedgerImportId],
      references: [reconciliationImports.id],
      relationName: "playerLedgerImport",
    }),
    pspImport: one(reconciliationImports, {
      fields: [reconciliationRuns.pspImportId],
      references: [reconciliationImports.id],
      relationName: "pspImport",
    }),
    items: many(reconciliationRunItems),
    matches: many(reconciliationMatches),
  })
);

export const reconciliationTransactionRelations = relations(
  reconciliationTransactions,
  ({ one }) => ({
    company: one(companies, {
      fields: [reconciliationTransactions.companyId],
      references: [companies.id],
    }),
    import: one(reconciliationImports, {
      fields: [reconciliationTransactions.importId],
      references: [reconciliationImports.id],
    }),
  })
);

export const reconciliationMatchRelations = relations(
  reconciliationMatches,
  ({ one }) => ({
    company: one(companies, {
      fields: [reconciliationMatches.companyId],
      references: [companies.id],
    }),
    run: one(reconciliationRuns, {
      fields: [reconciliationMatches.runId],
      references: [reconciliationRuns.id],
    }),
    playerTransaction: one(reconciliationTransactions, {
      fields: [reconciliationMatches.playerTransactionId],
      references: [reconciliationTransactions.id],
    }),
    pspTransaction: one(reconciliationTransactions, {
      fields: [reconciliationMatches.pspTransactionId],
      references: [reconciliationTransactions.id],
    }),
  })
);

export const reconciliationRunItemRelations = relations(
  reconciliationRunItems,
  ({ one }) => ({
    company: one(companies, {
      fields: [reconciliationRunItems.companyId],
      references: [companies.id],
    }),
    run: one(reconciliationRuns, {
      fields: [reconciliationRunItems.runId],
      references: [reconciliationRuns.id],
    }),
    transaction: one(reconciliationTransactions, {
      fields: [reconciliationRunItems.transactionId],
      references: [reconciliationTransactions.id],
    }),
  })
);

export const supplierInvoiceRelations = relations(
  supplierInvoices,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [supplierInvoices.companyId],
      references: [companies.id],
    }),
    vendor: one(vendors, {
      fields: [supplierInvoices.vendorId],
      references: [vendors.id],
    }),
    costCentre: one(costCentres, {
      fields: [supplierInvoices.costCentreId],
      references: [costCentres.id],
    }),
    documents: many(supplierInvoiceDocuments),
    lines: many(supplierInvoiceLines),
  })
);

export const supplierInvoiceDocumentRelations = relations(
  supplierInvoiceDocuments,
  ({ one }) => ({
    invoice: one(supplierInvoices, {
      fields: [supplierInvoiceDocuments.invoiceId],
      references: [supplierInvoices.id],
    }),
  })
);

export const supplierInvoiceLineRelations = relations(
  supplierInvoiceLines,
  ({ one }) => ({
    invoice: one(supplierInvoices, {
      fields: [supplierInvoiceLines.invoiceId],
      references: [supplierInvoices.id],
    }),
  })
);
