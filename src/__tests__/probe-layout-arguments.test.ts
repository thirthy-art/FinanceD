import { describe, expect, it } from "vitest";
import { parseProbeArguments } from "../../scripts/probe-layout-extraction";

describe("layout probe argument parsing", () => {
  it("accepts exactly one path and one optional OCR flag", () => {
    expect(parseProbeArguments(["invoice.pdf"])).toEqual({ localPathArg: "invoice.pdf", ocr: false });
    expect(parseProbeArguments(["--ocr", "invoice.pdf"])).toEqual({ localPathArg: "invoice.pdf", ocr: true });
  });

  it.each([
    { args: [] },
    { args: ["first.pdf", "second.pdf"] },
    { args: ["invoice.pdf", "--ocr", "--ocr"] },
    { args: ["invoice.pdf", "--unknown"] },
  ])("rejects ambiguous arguments: $args", ({ args }) => {
    expect(() => parseProbeArguments(args)).toThrow(/Usage:/);
  });
});
