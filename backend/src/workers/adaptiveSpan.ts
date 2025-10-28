const MAX_SPAN_BY_CHAIN = {
  1: 5_000,
  10: 5_000,
  56: 3_000,
  137: 1_000,
  42161: 5_000,
  43114: 3_000,
  8453: 3_000,
  324: 2_000,
  5000: 3_000,
} as const;

const DEFAULT_MIN_SPAN = parsePositiveBigInt(process.env.INDEXER_MIN_SPAN_DEFAULT) ?? 100n;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export const MAX_SPAN_RETRIES = 4;
export const ADAPTIVE_RETRY_DELAY_MS = parsePositiveInteger(process.env.INDEXER_BACKOFF_MS, 300);

const spanHints = new Map<number, bigint>();
const spanOverrides = new Map<number, { min?: bigint; max?: bigint }>();

export function resetSpanHints(): void {
  spanHints.clear();
}

export function setSpanOverrides(chainId: number, overrides: { min?: bigint; max?: bigint }): void {
  spanOverrides.set(chainId, overrides);
}

export function clearSpanOverrides(chainId?: number): void {
  if (typeof chainId === "number") {
    spanOverrides.delete(chainId);
    return;
  }

  spanOverrides.clear();
}

export function parsePositiveBigInt(value: string | undefined): bigint | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = BigInt(value);

    if (parsed > 0n) {
      return parsed;
    }
  } catch (error) {
    return null;
  }

  return null;
}

const DEFAULT_MAX_SPAN = parsePositiveBigInt(process.env.INDEXER_MAX_SPAN_DEFAULT) ?? 2_000n;

function resolveMinSpan(chainId: number): bigint {
  const overrideEntry = spanOverrides.get(chainId);
  if (overrideEntry?.min !== undefined) {
    return overrideEntry.min;
  }

  const envKey = `INDEXER_MIN_SPAN_${chainId}`;
  const envOverride = parsePositiveBigInt(process.env[envKey]);

  if (envOverride) {
    return envOverride;
  }

  return DEFAULT_MIN_SPAN;
}

export function resolveMaxSpan(chainId: number): bigint {
  const overrideEntry = spanOverrides.get(chainId);
  if (overrideEntry?.max !== undefined) {
    return overrideEntry.max;
  }

  const envKey = `INDEXER_MAX_SPAN_${chainId}`;
  const envOverride = parsePositiveBigInt(process.env[envKey]);

  if (envOverride) {
    return envOverride;
  }

  const configured = MAX_SPAN_BY_CHAIN[chainId as keyof typeof MAX_SPAN_BY_CHAIN];

  if (configured) {
    return BigInt(configured);
  }

  return DEFAULT_MAX_SPAN;
}

export function getInitialSpan(chainId: number, remaining: bigint, maxSpan?: bigint): bigint {
  const effectiveMax = maxSpan ?? resolveMaxSpan(chainId);
  const minSpan = resolveMinSpan(chainId);
  let span = spanHints.get(chainId) ?? effectiveMax;

  if (span > effectiveMax) {
    span = effectiveMax;
  }

  if (span > remaining) {
    span = remaining;
  }

  if (span < minSpan && remaining >= minSpan) {
    span = minSpan;
  }

  if (span < 1n) {
    span = remaining > 0n ? remaining : 1n;
  }

  return span;
}

export function rememberSpan(chainId: number, span: bigint): void {
  spanHints.set(chainId, span);
}

export function shrinkSpan(
  chainId: number,
  currentSpan: bigint,
  remaining: bigint,
  maxSpan?: bigint,
): bigint {
  const effectiveMax = maxSpan ?? resolveMaxSpan(chainId);
  const minSpan = resolveMinSpan(chainId);
  let next = currentSpan / 2n;

  if (next < minSpan && remaining >= minSpan) {
    next = minSpan;
  }

  if (next > remaining) {
    next = remaining;
  }

  if (next < 1n) {
    next = remaining > 0n ? remaining : 1n;
  }

  if (next < minSpan && remaining >= minSpan) {
    next = minSpan;
  }

  if (next > effectiveMax) {
    next = effectiveMax;
  }

  spanHints.set(chainId, next);
  return next;
}

export function isBlockRangeTooLargeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const anyError = error as { code?: number };

  if (typeof anyError.code === "number" && (anyError.code === -32062 || anyError.code === -32602)) {
    return true;
  }

  const message = error.message.toLowerCase();

  if (message.includes("-32062") || message.includes("-32602")) {
    return true;
  }

  if (message.includes("status 413") || message.includes("payload too large")) {
    return true;
  }

  return false;
}
