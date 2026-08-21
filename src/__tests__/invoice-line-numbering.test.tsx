import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AiInvoiceExtraction } from "@/src/lib/ai-extraction";
import {
  applyExtractionLines,
  extractionLinesToEditable,
} from "@/src/lib/apply-ai-extraction";
import InvoiceLinesEditor from "@/src/components/InvoiceLinesEditor";
import {
  editableLineToInput,
  emptyEditableInvoiceLine,
  fillMissingLineNumbers,
  isCompletelyEmptyLine,
  normalizeInvoiceLineInput,
  type EditableInvoiceLine,
} from "@/src/lib/invoice-lines";

vi.mock("@/src/i18n/context", async () => {
  const { getMessages } = await import("@/src/i18n/index");
  return {
    useI18n: () => ({
      locale: "en" as const,
      t: getMessages("en"),
      setLocale: () => undefined,
    }),
  };
});

function extractionWithLineNumbers(lineNumbers: Array<string | null>): AiInvoiceExtraction {
  return {
    vendorOriginal: null,
    vendorNormalized: null,
    vendorTaxId: null,
    invoiceNumber: null,
    invoiceDate: null,
    dueDate: null,
    currency: null,
    netAmount: null,
    vatAmount: null,
    grossAmount: null,
    lines: lineNumbers.map((lineNumber, index) => ({
      lineNumber,
      descriptionOriginal: `Source ${index + 1}`,
      description: `Line ${index + 1}`,
      quantity: "1",
      unit: null,
      unitPrice: "10",
      netAmount: "10",
      vatRate: null,
      vatAmount: null,
      grossAmount: null,
      sourcePage: 1,
    })),
  };
}

function findFirstButton(node: ReactNode): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === "button") return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Children.toArray(children)) {
    const button = findFirstButton(child);
    if (button) return button;
  }
  return null;
}

describe("automatic invoice line numbering", () => {
  it("numbers three blank line numbers by 1-based display position", () => {
    const lines = Array.from({ length: 3 }, () => emptyEditableInvoiceLine());
    expect(fillMissingLineNumbers(lines).map((line) => line.lineNumber)).toEqual(["1", "2", "3"]);
  });

  it("preserves existing nonblank line numbers exactly", () => {
    const lines = ["10", "A-1", " B-7 "].map((lineNumber) => ({
      ...emptyEditableInvoiceLine(),
      lineNumber,
    }));
    expect(fillMissingLineNumbers(lines).map((line) => line.lineNumber)).toEqual(["10", "A-1", " B-7 "]);
  });

  it("uses position fallback for mixed explicit and blank line numbers", () => {
    const lines = ["10", "", "30"].map((lineNumber) => ({
      ...emptyEditableInvoiceLine(),
      lineNumber,
    }));
    expect(fillMissingLineNumbers(lines).map((line) => line.lineNumber)).toEqual(["10", "2", "30"]);
  });

  it("preserves real AI line numbers", () => {
    const lines = extractionLinesToEditable(extractionWithLineNumbers(["A-1", "B-7"]));
    expect(lines.map((line) => line.lineNumber)).toEqual(["A-1", "B-7"]);
  });

  it("numbers blank AI lines before producing a stable applied signature", () => {
    const extractedLines = extractionLinesToEditable(extractionWithLineNumbers([null, "", "30"]));
    const first = applyExtractionLines([], extractedLines, null);
    const second = applyExtractionLines(
      first.lines,
      extractionLinesToEditable(extractionWithLineNumbers([null, "", "30"])),
      first.signature,
    );

    expect(first.lines.map((line) => line.lineNumber)).toEqual(["1", "2", "30"]);
    expect(second.applied).toBe(true);
    expect(second.signature).toBe(first.signature);
  });

  it("gives Add Line the next display-position number immediately", () => {
    const lines = ["1", "2", "3"].map((lineNumber) => ({
      ...emptyEditableInvoiceLine(),
      lineNumber,
    }));
    const captured: { lines: EditableInvoiceLine[] | null } = { lines: null };
    const tree = InvoiceLinesEditor({
      lines,
      postingAccounts: [],
      invoiceNetAmount: "0",
      onChange: (nextLines) => { captured.lines = nextLines; },
    });
    const addButton = findFirstButton(tree);

    expect(addButton).not.toBeNull();
    (addButton!.props as { onClick: () => void }).onClick();
    expect(captured.lines?.map((line) => line.lineNumber)).toEqual(["1", "2", "3", "4"]);
  });

  it("treats an otherwise-empty auto-numbered line as completely empty", () => {
    expect(isCompletelyEmptyLine({ ...emptyEditableInvoiceLine(), lineNumber: "4" })).toBe(true);
  });

  it("numbers a meaningful blank-numbered line after validation and normalization", () => {
    const meaningful = { ...emptyEditableInvoiceLine(), description: "Consulting" };
    const normalized = normalizeInvoiceLineInput(editableLineToInput(meaningful), 0);
    const [preparedForPersistence] = fillMissingLineNumbers([normalized]);

    expect(preparedForPersistence.lineNumber).toBe("1");
    expect(preparedForPersistence.description).toBe("Consulting");
  });

  it("keeps existing meaningful-line behavior intact", () => {
    const meaningful = {
      ...emptyEditableInvoiceLine(),
      lineNumber: "A-9",
      description: "Consulting",
      netAmount: "100",
    };
    const [numbered] = fillMissingLineNumbers([meaningful]);

    expect(isCompletelyEmptyLine(meaningful)).toBe(false);
    expect(numbered).toBe(meaningful);
    expect(numbered).toEqual(meaningful);
  });
});
