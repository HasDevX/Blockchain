import { describe, expect, it } from "vitest";
import { byteaToHex, hexToBytea } from "../sql";

describe("sql hex helpers", () => {
  it("converts prefixed hex to bytea", () => {
    const buffer = hexToBytea("0xdeadbeef");
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("hex")).toBe("deadbeef");
  });

  it("converts unprefixed hex to bytea", () => {
    const buffer = hexToBytea("cafebabe");
    expect(buffer?.toString("hex")).toBe("cafebabe");
  });

  it("pads leading zero for odd-length hex", () => {
    const buffer = hexToBytea("abc");
    expect(buffer?.toString("hex")).toBe("0abc");
  });

  it("returns empty buffer for empty string", () => {
    const buffer = hexToBytea("");
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer?.length).toBe(0);
  });

  it("throws for invalid hex", () => {
    expect(() => hexToBytea("0xzz")).toThrow(/invalid hex/i);
  });

  it("converts bytea to prefixed hex", () => {
    const hex = byteaToHex(Buffer.from("010203", "hex"));
    expect(hex).toBe("0x010203");
  });

  it("converts bytea to hex without prefix", () => {
    const hex = byteaToHex(Buffer.from("0102", "hex"), false);
    expect(hex).toBe("0102");
  });

  it("returns null for null bytea", () => {
    expect(byteaToHex(null)).toBeNull();
  });
});
