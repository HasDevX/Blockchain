const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatNumber(value: number | string): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return "-";
  }

  return numberFormatter.format(numeric);
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return compactNumberFormatter.format(value);
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "$-";
  }

  return `$${value.toFixed(2)}`;
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2) {
    return address;
  }

  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
