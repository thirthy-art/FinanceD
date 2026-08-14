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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  address: text("address"),
  defaultCurrency: varchar("default_currency", { length: 10 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Supplier Invoices ────────────────────────────────────────────────────────

export const supplierInvoices = pgTable("supplier_invoices", {
  id: serial("id").primaryKey(),
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
