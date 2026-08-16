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

// ─── Companies ────────────────────────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  baseCurrency: varchar("base_currency", { length: 10 }).notNull().default("EUR"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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

// ─── Relations ────────────────────────────────────────────────────────────────

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
