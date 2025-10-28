const HEX_REGEX = /^[0-9a-f]+$/i;

function normalizeHex(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

export function hexToBytea(hex: string | null | undefined): Buffer | null {
  if (hex === null || hex === undefined) {
    return null;
  }

  const normalized = normalizeHex(hex);

  if (normalized.length === 0) {
    return Buffer.alloc(0);
  }

  if (!HEX_REGEX.test(normalized)) {
    throw new Error(`Invalid hex value: ${hex}`);
  }

  if (normalized.length % 2 !== 0) {
    return Buffer.from(`0${normalized}`, "hex");
  }

  return Buffer.from(normalized, "hex");
}

export function byteaToHex(value: Buffer | null | undefined, withPrefix = true): string | null {
  if (!value) {
    return null;
  }

  const hex = value.toString("hex");
  return withPrefix ? `0x${hex}` : hex;
}
