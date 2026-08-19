import { describe, expect, it } from "vitest";
import {
  InvoiceLineInputSchema,
  validateLineAccountsForApproval,
  validateLineRecognitionForApproval,
  type InvoiceLineApprovalAccount,
  type InvoiceLineInput,
} from "@/src/lib/invoice-lines";

const COMPANY_ID = 1;

function line(overrides: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    lineNumber: null,
    descriptionOriginal: null,
    description: "Services",
    quantity: null,
    unit: null,
    unitPrice: null,
    netAmount: "100",
    vatRate: "0",
    vatAmount: "0",
    grossAmount: "100",
    sourcePage: null,
    recognitionTreatment: "Immediate",
    recognitionStartDate: null,
    recognitionEndDate: null,
    accountingAccountNumber: null,
    prepaidAccountNumber: null,
    netAmountDerived: false,
    vatAmountDerived: false,
    grossAmountDerived: false,
    ...overrides,
  };
}

function account(
  code: string,
  type: InvoiceLineApprovalAccount["type"],
  overrides: Partial<InvoiceLineApprovalAccount> = {},
): InvoiceLineApprovalAccount {
  return {
    code,
    companyId: COMPANY_ID,
    type,
    isActive: true,
    isPosting: true,
    ...overrides,
  };
}

function accountMap(...accounts: InvoiceLineApprovalAccount[]) {
  return new Map(accounts.map((item) => [item.code, item]));
}

describe("invoice-line account approval validation", () => {
  it("accepts a valid active posting expense account", () => {
    const error = validateLineAccountsForApproval(
      line({ accountingAccountNumber: "6000" }),
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense")),
    );
    expect(error).toBeNull();
  });

  it("rejects a nonexistent expense code", () => {
    const error = validateLineAccountsForApproval(
      line({ accountingAccountNumber: "9999" }),
      2,
      COMPANY_ID,
      accountMap(),
    );
    expect(error).toMatch(/Line 2.*Expense account.*active posting expense account/);
  });

  it("rejects an expense code belonging to another company", () => {
    const error = validateLineAccountsForApproval(
      line({ accountingAccountNumber: "6000" }),
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense", { companyId: 2 })),
    );
    expect(error).toMatch(/for this company/);
  });

  it("rejects inactive and non-posting expense accounts", () => {
    const invoiceLine = line({ accountingAccountNumber: "6000" });
    expect(validateLineAccountsForApproval(
      invoiceLine,
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense", { isActive: false })),
    )).toMatch(/active posting expense account/);
    expect(validateLineAccountsForApproval(
      invoiceLine,
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense", { isPosting: false })),
    )).toMatch(/active posting expense account/);
  });

  it("accepts Prepaid with valid expense and asset accounts", () => {
    const prepaidLine = line({
      recognitionTreatment: "Prepaid",
      recognitionStartDate: "2026-01-01",
      recognitionEndDate: "2026-03-31",
      accountingAccountNumber: "6000",
      prepaidAccountNumber: "1700",
    });
    expect(validateLineRecognitionForApproval(prepaidLine, 1)).toBeNull();
    expect(validateLineAccountsForApproval(
      prepaidLine,
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense"), account("1700", "asset")),
    )).toBeNull();
  });

  it("rejects a Prepaid asset code that points to an expense account", () => {
    const error = validateLineAccountsForApproval(
      line({
        recognitionTreatment: "Prepaid",
        recognitionStartDate: "2026-01-01",
        recognitionEndDate: "2026-03-31",
        accountingAccountNumber: "6000",
        prepaidAccountNumber: "1700",
      }),
      1,
      COMPANY_ID,
      accountMap(account("6000", "expense"), account("1700", "expense")),
    );
    expect(error).toMatch(/Prepaid asset account.*active posting asset account/);
  });

  it("keeps draft input parsing permissive for unfinished account codes", () => {
    expect(InvoiceLineInputSchema.safeParse(
      line({ accountingAccountNumber: "unfinished-code" }),
    ).success).toBe(true);
  });
});
