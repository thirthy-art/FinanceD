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

export const lineTreatmentEnum = pgEnum("line_treatment", [
  "immediate",
  "prepaid",
]);

// ─── Companies ────────────────────────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull().default("USD"),
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
});

// ─── Cost Centres ────────────────────────────────────────────────────────────

export const costCentres = pgTable("cost_centres", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  code: varchar("code", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Vendors ─────────────────────────────────────────────────────────────────

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id),
  name: varchar("name", { length: 255 }).notNull(),
  taxId: varchar("tax_id", { length: 50 }),
  address: text("address"),
  defaultCurrency: varchar("default_currency", { length: 3 }),
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
  invoiceDate: varchar("invoice_date", { length: 10 }), // ISO date string YYYY-MM-DD
  dueDate: varchar("due_date", { length: 10 }),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  fxRate: numeric("fx_rate", { precision: 18, scale: 6 }).default("1"),
  fxRateSource: varchar("fx_rate_source", { length: 50 }),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }),
  vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }),
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

// ─── Supplier Invoice Lines ───────────────────────────────────────────────────

export const supplierInvoiceLines = pgTable("supplier_invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => supplierInvoices.id),
  lineNumber: integer("line_number").notNull(),
  descriptionOriginal: text("description_original"),
  description: text("description"),
  quantity: numeric("quantity", { precision: 18, scale: 4 }),
  unit: varchar("unit", { length: 50 }),
  unitPrice: numeric("unit_price", { precision: 18, scale: 2 }),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }),
  vatRate: numeric("vat_rate", { precision: 6, scale: 3 }),
  vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }),
  sourcePage: integer("source_page"),
  treatment: lineTreatmentEnum("treatment").notNull().default("immediate"),
  accountingAccountNumber: varchar("accounting_account_number", { length: 20 }),
  prepaidAccountNumber: varchar("prepaid_account_number", { length: 20 }),
  recognitionStart: varchar("recognition_start", { length: 10 }),
  recognitionEnd: varchar("recognition_end", { length: 10 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
