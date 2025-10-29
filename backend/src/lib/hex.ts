const HEX_PATTERN = /^0x[0-9a-f]+$/i;

export function safeHexToBigInt(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (!trimmed.toLowerCase().startsWith("0x")) {
    return null;
  }

  if (trimmed.toLowerCase() === "0x") {
    return null;
  }

  if (!HEX_PATTERN.test(trimmed)) {
    return null;
  }

  try {
    return BigInt(trimmed);
  } catch (error) {
    return null;
  }
}
