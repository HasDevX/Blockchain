import { describe, expect, it } from "vitest";
import { safeHexToBigInt } from "../hex";

describe("safeHexToBigInt", () => {
  it("returns null for nullish input", () => {
    expect(safeHexToBigInt(null)).toBeNull();
    expect(safeHexToBigInt(undefined)).toBeNull();
  });

  it("returns null for empty or bare prefix", () => {
    expect(safeHexToBigInt("")).toBeNull();
    expect(safeHexToBigInt("0x")).toBeNull();
    expect(safeHexToBigInt("0X")).toBeNull();
  });

  it("parses valid hex strings", () => {
    expect(safeHexToBigInt("0x0")).toBe(0n);
    expect(safeHexToBigInt("0x01")).toBe(1n);
    expect(safeHexToBigInt("0xabc")).toBe(0xabcn);
    expect(safeHexToBigInt("0xABC")).toBe(0xabcn);
  });

  it("returns null for invalid hex patterns", () => {
    expect(safeHexToBigInt("0xzz")).toBeNull();
    expect(safeHexToBigInt("123")).toBeNull();
  });
});
