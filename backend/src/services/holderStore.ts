import { PoolClient } from "pg";
import { safeHexToBigInt } from "../lib/hex";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface TransferLog {
  from: string;
  to: string;
  value: bigint;
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  removed?: boolean;
}

export class InvalidTransferValueError extends Error {
  constructor(readonly value: string | null | undefined) {
    super(`invalid transfer log value: ${value ?? "null"}`);
    this.name = "InvalidTransferValueError";
  }
}

export function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;

  if (hex.length !== 40) {
    throw new Error(`invalid address length for ${address}`);
  }

  if (!/^([0-9a-f]{40})$/.test(hex)) {
    throw new Error(`invalid address format for ${address}`);
  }

  return `0x${hex}`;
}

export function addressToBuffer(address: string): Buffer {
  const normalized = normalizeAddress(address);
  return Buffer.from(normalized.slice(2), "hex");
}

export function bufferToAddress(buffer: Buffer): string {
  return `0x${buffer.toString("hex")}`;
}

export function topicToAddress(topic: string): string {
  if (!topic || typeof topic !== "string") {
    throw new Error("invalid topic");
  }

  const normalized = topic.toLowerCase();

  if (!normalized.startsWith("0x")) {
    throw new Error(`invalid topic hex: ${topic}`);
  }

  const hex = normalized.slice(-40);
  return normalizeAddress(hex);
}

export function decodeTransferLogs(logs: RpcLog[]): TransferLog[] {
  const transfers: TransferLog[] = [];

  for (const log of logs) {
    if (log.removed === true) {
      continue;
    }

    if (!Array.isArray(log.topics) || log.topics.length < 3) {
      continue;
    }

    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) {
      continue;
    }

    const from = topicToAddress(log.topics[1]);
    const to = topicToAddress(log.topics[2]);
    const value = decodeValue(log.data);

    transfers.push({ from, to, value });
  }

  return transfers;
}

export function decodeValue(data: string): bigint {
  if (typeof data !== "string") {
    throw new InvalidTransferValueError(data);
  }

  const parsed = safeHexToBigInt(data);

  if (parsed === null) {
    throw new InvalidTransferValueError(data);
  }

  return parsed;
}

export function aggregateTransferDeltas(transfers: TransferLog[]): Map<string, bigint> {
  const deltas = new Map<string, bigint>();

  for (const transfer of transfers) {
    if (transfer.value === 0n) {
      continue;
    }

    if (transfer.from !== ZERO_ADDRESS) {
      const next = (deltas.get(transfer.from) ?? 0n) - transfer.value;
      deltas.set(transfer.from, next);
    }

    if (transfer.to !== ZERO_ADDRESS) {
      const next = (deltas.get(transfer.to) ?? 0n) + transfer.value;
      deltas.set(transfer.to, next);
    }
  }

  return deltas;
}

export async function applyHolderDeltas(
  client: PoolClient,
  chainId: number,
  tokenAddress: string,
  deltas: Map<string, bigint>,
): Promise<void> {
  if (deltas.size === 0) {
    return;
  }

  const normalizedToken = normalizeAddress(tokenAddress);
  const tokenBuffer = addressToBuffer(normalizedToken);
  const holders = Array.from(deltas.keys());

  const holderBuffers = holders.map(addressToBuffer);

  const existingBalancesQuery = await client.query<{
    holder: Buffer;
    balance: string;
  }>(
    `SELECT holder, balance
     FROM token_holders
     WHERE chain_id = $1 AND token = $2 AND holder = ANY($3)`,
    [chainId, tokenBuffer, holderBuffers],
  );

  const existing = new Map<string, bigint>();
  for (const row of existingBalancesQuery.rows) {
    existing.set(bufferToAddress(row.holder), BigInt(row.balance));
  }

  for (const holder of holders) {
    const delta = deltas.get(holder) ?? 0n;

    if (delta === 0n) {
      continue;
    }

    const current = existing.get(holder) ?? 0n;
    const next = current + delta;
    const holderBuffer = addressToBuffer(holder);

    if (next <= 0n) {
      await client.query(
        `DELETE FROM token_holders
         WHERE chain_id = $1 AND token = $2 AND holder = $3`,
        [chainId, tokenBuffer, holderBuffer],
      );
      continue;
    }

    await client.query(
      `INSERT INTO token_holders (chain_id, token, holder, balance, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (chain_id, token, holder)
       DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW()`,
      [chainId, tokenBuffer, holderBuffer, next.toString()],
    );
  }
}
