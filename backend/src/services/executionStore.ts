import { PoolClient } from "pg";
import { getPool, withTransaction } from "../lib/db";
import { byteaToHex, hexToBytea } from "../lib/sql";
import {
  addressToBuffer,
  applyHolderDeltas,
  bufferToAddress,
  normalizeAddress,
} from "./holderStore";

export interface BlockRow {
  chainId: number;
  number: bigint;
  hash: Buffer;
  parentHash: Buffer;
  timestamp: Date;
}

export interface TransactionRow {
  chainId: number;
  hash: Buffer;
  blockNumber: bigint;
  from: Buffer;
  to: Buffer | null;
  value: string;
  nonce: string;
  gas: string | null;
  gasPrice: string | null;
  input: Buffer | null;
}

export interface ReceiptRow {
  chainId: number;
  txHash: Buffer;
  status: boolean | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  contractAddress: Buffer | null;
}

export interface LogRow {
  chainId: number;
  txHash: Buffer;
  logIndex: number;
  address: Buffer;
  topic0: Buffer | null;
  topic1: Buffer | null;
  topic2: Buffer | null;
  topic3: Buffer | null;
  data: Buffer | null;
}

export interface TokenTransferRow {
  chainId: number;
  txHash: Buffer;
  logIndex: number;
  token: Buffer;
  from: Buffer;
  to: Buffer;
  value: string;
}

export interface HolderDelta {
  token: string;
  deltas: Map<string, bigint>;
}

export interface ExecutionBatch {
  chainId: number;
  fromBlock: bigint;
  toBlock: bigint;
  blocks: BlockRow[];
  transactions: TransactionRow[];
  receipts: ReceiptRow[];
  logs: LogRow[];
  tokenTransfers: TokenTransferRow[];
  holderDeltas: HolderDelta[];
}

export interface TransactionLogEntry {
  index: number;
  address: string;
  topics: Array<string | null>;
  data: string | null;
}

export interface TokenTransferEntry {
  logIndex: number;
  token: string;
  from: string;
  to: string;
  value: string;
}

export interface TransactionDetails {
  chainId: number;
  hash: string;
  blockNumber: string;
  blockHash: string | null;
  timestamp: string | null;
  from: string;
  to: string | null;
  value: string;
  nonce: string;
  gas: string | null;
  gasPrice: string | null;
  input: string | null;
  methodSignature: string | null;
  methodSelector: string | null;
  status: boolean | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  contractAddress: string | null;
  logs: TransactionLogEntry[];
  tokenTransfers: TokenTransferEntry[];
}

export class InvalidTransactionHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionHashError";
  }
}

export interface AddressActivityEntry {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string | null;
  token: string;
  from: string;
  to: string;
  value: string;
  direction: "in" | "out";
}

export interface AddressActivityResponse {
  items: AddressActivityEntry[];
  transactions: AddressActivityTransaction[];
  tokenTransfers: AddressActivityEntry[];
  nextCursor?: string;
}

export interface AddressActivityTransaction {
  hash: string;
  blockNumber: string;
  timestamp: string | null;
  from: string;
  to: string | null;
  value: string;
  status: boolean | null;
  tokenTransfers: AddressActivityEntry[];
}

export interface GetAddressActivityParams {
  chainId: number;
  address: string;
  limit?: number;
  cursor?: string | null;
}

interface TransactionQueryRow {
  hash: Buffer;
  blockNumber: string;
  fromAddress: Buffer;
  toAddress: Buffer | null;
  value: string;
  nonce: string;
  gas: string | null;
  gasPrice: string | null;
  inputData: Buffer | null;
  status: boolean | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  contractAddress: Buffer | null;
  blockTimestamp: Date | null;
  blockHash: Buffer | null;
}

interface LogQueryRow {
  logIndex: number;
  address: Buffer;
  topic0: Buffer | null;
  topic1: Buffer | null;
  topic2: Buffer | null;
  topic3: Buffer | null;
  data: Buffer | null;
}

interface TokenTransferQueryRow {
  logIndex: number;
  token: Buffer;
  fromAddress: Buffer;
  toAddress: Buffer;
  value: string;
}

interface AddressActivityQueryRow {
  txHash: Buffer;
  logIndex: number;
  blockNumber: string;
  timestamp: Date | null;
  token: Buffer;
  fromAddress: Buffer;
  toAddress: Buffer;
  value: string;
  txFrom: Buffer;
  txTo: Buffer | null;
  txValue: string;
  txStatus: boolean | null;
}

interface AddressActivityCursor {
  blockNumber: bigint;
  logIndex: number;
}

function normalizeTransactionHash(raw: string): string {
  if (typeof raw !== "string") {
    throw new InvalidTransactionHashError("transaction_hash_required");
  }

  const trimmed = raw.trim().toLowerCase();

  if (!/^0x[0-9a-f]{64}$/.test(trimmed)) {
    throw new InvalidTransactionHashError("invalid_transaction_hash");
  }

  return trimmed;
}

export async function getTransactionDetails(
  chainId: number,
  hash: string,
): Promise<TransactionDetails | null> {
  const normalizedHash = normalizeTransactionHash(hash);
  const hashBuffer = hexToBytea(normalizedHash);
  if (!hashBuffer) {
    return null;
  }
  const pool = getPool();

  const txResult = await pool.query<TransactionQueryRow>(
    `SELECT
       tx.hash,
       tx.block_number::TEXT AS "blockNumber",
       tx."from" AS "fromAddress",
       tx."to" AS "toAddress",
       tx.value::TEXT AS value,
       tx.nonce::TEXT AS nonce,
       tx.gas::TEXT AS gas,
       tx.gas_price::TEXT AS "gasPrice",
       tx.input AS "inputData",
       rc.status,
       rc.gas_used::TEXT AS "gasUsed",
       rc.effective_gas_price::TEXT AS "effectiveGasPrice",
       rc.contract_address AS "contractAddress",
       bl."timestamp" AS "blockTimestamp",
       bl.hash AS "blockHash"
     FROM transactions tx
     LEFT JOIN receipts rc
       ON rc.chain_id = tx.chain_id AND rc.tx_hash = tx.hash
     LEFT JOIN blocks bl
       ON bl.chain_id = tx.chain_id AND bl.number = tx.block_number
     WHERE tx.chain_id = $1 AND tx.hash = $2
     LIMIT 1`,
    [chainId, hashBuffer],
  );

  if (txResult.rowCount === 0) {
    return null;
  }

  const row = txResult.rows[0]!;
  const logs = await fetchTransactionLogs(pool, chainId, hashBuffer);
  const tokenTransfers = await fetchTokenTransfers(pool, chainId, hashBuffer);
  const input = byteaToHex(row.inputData);
  const decodedMethod = decodeCalldataMethod(input);

  const details: TransactionDetails = {
    chainId,
    hash: normalizedHash,
    blockNumber: row.blockNumber,
    blockHash: byteaToHex(row.blockHash),
    timestamp: row.blockTimestamp ? row.blockTimestamp.toISOString() : null,
    from: bufferToAddress(row.fromAddress),
    to: row.toAddress ? bufferToAddress(row.toAddress) : null,
    value: row.value,
    nonce: row.nonce,
    gas: row.gas,
    gasPrice: row.gasPrice,
    input,
    methodSignature: decodedMethod.signature,
    methodSelector: decodedMethod.selector,
    status: row.status,
    gasUsed: row.gasUsed,
    effectiveGasPrice: row.effectiveGasPrice,
    contractAddress: row.contractAddress ? bufferToAddress(row.contractAddress) : null,
    logs,
    tokenTransfers,
  };

  return details;
}

const KNOWN_METHOD_SIGNATURES: Record<string, string> = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0xdd62ed3e": "allowance(address,address)",
  "0x18160ddd": "totalSupply()",
  "0x70a08231": "balanceOf(address)",
  "0x313ce567": "decimals()",
  "0x06fdde03": "name()",
  "0x95d89b41": "symbol()",
};

function decodeCalldataMethod(input: string | null): {
  signature: string | null;
  selector: string | null;
} {
  if (!input || input === "0x" || input.toLowerCase() === "0x0" || input.length < 10) {
    return { signature: null, selector: null };
  }

  const selector = input.slice(0, 10).toLowerCase();
  const signature = KNOWN_METHOD_SIGNATURES[selector] ?? null;

  return {
    signature,
    selector,
  };
}

async function fetchTransactionLogs(
  pool: ReturnType<typeof getPool>,
  chainId: number,
  hashBuffer: Buffer,
): Promise<TransactionLogEntry[]> {
  const result = await pool.query<LogQueryRow>(
    `SELECT
       log_index AS "logIndex",
       address,
       topic0,
       topic1,
       topic2,
       topic3,
       data
     FROM logs
     WHERE chain_id = $1 AND tx_hash = $2
     ORDER BY log_index ASC`,
    [chainId, hashBuffer],
  );

  return result.rows.map((log) => ({
    index: log.logIndex,
    address: bufferToAddress(log.address),
    topics: [log.topic0, log.topic1, log.topic2, log.topic3].map((topic) => byteaToHex(topic)),
    data: byteaToHex(log.data),
  }));
}

async function fetchTokenTransfers(
  pool: ReturnType<typeof getPool>,
  chainId: number,
  hashBuffer: Buffer,
): Promise<TokenTransferEntry[]> {
  const result = await pool.query<TokenTransferQueryRow>(
    `SELECT
       log_index AS "logIndex",
       token,
       "from" AS "fromAddress",
       "to" AS "toAddress",
       value::TEXT AS value
     FROM token_transfers
     WHERE chain_id = $1 AND tx_hash = $2
     ORDER BY log_index ASC`,
    [chainId, hashBuffer],
  );

  return result.rows.map((transfer) => ({
    logIndex: transfer.logIndex,
    token: bufferToAddress(transfer.token),
    from: bufferToAddress(transfer.fromAddress),
    to: bufferToAddress(transfer.toAddress),
    value: transfer.value,
  }));
}

const DEFAULT_ACTIVITY_LIMIT = 25;
const MAX_ACTIVITY_LIMIT = 100;

function clampActivityLimit(raw?: number): number {
  if (!Number.isFinite(raw ?? NaN)) {
    return DEFAULT_ACTIVITY_LIMIT;
  }

  const normalized = Math.floor(raw as number);

  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_ACTIVITY_LIMIT) {
    return MAX_ACTIVITY_LIMIT;
  }

  return normalized;
}

function decodeAddressActivityCursor(raw?: string | null): AddressActivityCursor | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const [blockPart, logPart] = trimmed.split(":");
  if (!blockPart || !logPart) {
    return null;
  }

  try {
    const blockNumber = BigInt(blockPart);
    const logIndex = Number(logPart);

    if (!Number.isInteger(logIndex) || logIndex < 0) {
      return null;
    }

    return { blockNumber, logIndex };
  } catch (error) {
    console.warn("invalid address activity cursor", error);
    return null;
  }
}

function encodeAddressActivityCursor(cursor: AddressActivityCursor): string {
  return `${cursor.blockNumber.toString(10)}:${cursor.logIndex}`;
}

export async function getAddressActivity({
  chainId,
  address,
  limit,
  cursor,
}: GetAddressActivityParams): Promise<AddressActivityResponse> {
  const normalizedAddress = normalizeAddress(address);
  const addressBuffer = addressToBuffer(normalizedAddress);
  const pageSize = clampActivityLimit(limit);
  const cursorData = decodeAddressActivityCursor(cursor);
  const pool = getPool();

  const params: unknown[] = [chainId, addressBuffer, pageSize];
  let cursorClause = "";

  if (cursorData) {
    params.push(cursorData.blockNumber.toString(), cursorData.logIndex);
    cursorClause =
      "AND (tx.block_number < $4::NUMERIC OR (tx.block_number = $4::NUMERIC AND tt.log_index < $5))";
  }

  const result = await pool.query<AddressActivityQueryRow>(
    `SELECT
       tt.tx_hash AS "txHash",
       tt.log_index AS "logIndex",
       tx.block_number::TEXT AS "blockNumber",
       bl."timestamp" AS "timestamp",
       tt.token,
       tt."from" AS "fromAddress",
       tt."to" AS "toAddress",
       tt.value::TEXT AS value,
       tx."from" AS "txFrom",
       tx."to" AS "txTo",
       tx.value::TEXT AS "txValue",
       rc.status AS "txStatus"
     FROM token_transfers tt
     JOIN transactions tx
       ON tx.chain_id = tt.chain_id AND tx.hash = tt.tx_hash
     LEFT JOIN blocks bl
       ON bl.chain_id = tx.chain_id AND bl.number = tx.block_number
     LEFT JOIN receipts rc
       ON rc.chain_id = tx.chain_id AND rc.tx_hash = tx.hash
     WHERE tt.chain_id = $1
       AND (tt."from" = $2 OR tt."to" = $2)
       ${cursorClause}
     ORDER BY tx.block_number DESC, tt.log_index DESC
     LIMIT $3`,
    params,
  );

  const transactionsByHash = new Map<string, AddressActivityTransaction>();
  const items: AddressActivityEntry[] = result.rows.map((row) => {
    const fromAddress = bufferToAddress(row.fromAddress);
    const toAddress = bufferToAddress(row.toAddress);
    let direction: "in" | "out" = "out";

    if (toAddress === normalizedAddress) {
      direction = "in";
    } else if (fromAddress === normalizedAddress) {
      direction = "out";
    }

    const txHash = byteaToHex(row.txHash) ?? "0x";

    if (!transactionsByHash.has(txHash)) {
      transactionsByHash.set(txHash, {
        hash: txHash,
        blockNumber: row.blockNumber,
        timestamp: row.timestamp ? row.timestamp.toISOString() : null,
        from: bufferToAddress(row.txFrom),
        to: row.txTo ? bufferToAddress(row.txTo) : null,
        value: row.txValue,
        status: row.txStatus,
        tokenTransfers: [],
      });
    }

    const transaction = transactionsByHash.get(txHash);

    const entry: AddressActivityEntry = {
      txHash,
      logIndex: row.logIndex,
      blockNumber: row.blockNumber,
      timestamp: row.timestamp ? row.timestamp.toISOString() : null,
      token: bufferToAddress(row.token),
      from: fromAddress,
      to: toAddress,
      value: row.value,
      direction,
    };

    transaction?.tokenTransfers.push(entry);

    return entry;
  });

  const nextCursor =
    items.length === pageSize
      ? encodeAddressActivityCursor({
          blockNumber: BigInt(items[items.length - 1]!.blockNumber),
          logIndex: items[items.length - 1]!.logIndex,
        })
      : undefined;

  return {
    items,
    tokenTransfers: items,
    transactions: Array.from(transactionsByHash.values()),
    nextCursor,
  };
}

export async function storeExecutionBatch(batch: ExecutionBatch): Promise<void> {
  await withTransaction(async (client) => {
    await insertBlocks(client, batch.blocks);
    await insertTransactions(client, batch.transactions);
    await insertReceipts(client, batch.receipts);
    await insertLogs(client, batch.logs);
    await insertTokenTransfers(client, batch.tokenTransfers);

    for (const { token, deltas } of batch.holderDeltas) {
      await applyHolderDeltas(client, batch.chainId, token, deltas);
    }

    await upsertCheckpoint(client, batch.chainId, batch.toBlock);
  });
}

export async function getCheckpoint(chainId: number): Promise<bigint | null> {
  const pool = getPool();
  const result = await pool.query<{ last_block_scanned: string | null }>(
    `SELECT last_block_scanned::TEXT AS last_block_scanned
     FROM job_checkpoints
     WHERE chain_id = $1`,
    [chainId],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const value = result.rows[0]?.last_block_scanned;
  return value ? BigInt(value) : null;
}

async function insertBlocks(client: PoolClient, rows: BlockRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chain_id, number)
       DO NOTHING`,
      [row.chainId, row.number.toString(), row.hash, row.parentHash, row.timestamp],
    );
  }
}

async function insertTransactions(client: PoolClient, rows: TransactionRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO transactions (chain_id, hash, block_number, "from", "to", value, nonce, gas, gas_price, input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (chain_id, hash)
       DO NOTHING`,
      [
        row.chainId,
        row.hash,
        row.blockNumber.toString(),
        row.from,
        row.to,
        row.value,
        row.nonce,
        row.gas,
        row.gasPrice,
        row.input,
      ],
    );
  }
}

async function insertReceipts(client: PoolClient, rows: ReceiptRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO receipts (chain_id, tx_hash, status, gas_used, effective_gas_price, contract_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (chain_id, tx_hash)
       DO NOTHING`,
      [
        row.chainId,
        row.txHash,
        row.status,
        row.gasUsed,
        row.effectiveGasPrice,
        row.contractAddress,
      ],
    );
  }
}

async function insertLogs(client: PoolClient, rows: LogRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO logs (chain_id, tx_hash, log_index, address, topic0, topic1, topic2, topic3, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (chain_id, tx_hash, log_index)
       DO NOTHING`,
      [
        row.chainId,
        row.txHash,
        row.logIndex,
        row.address,
        row.topic0,
        row.topic1,
        row.topic2,
        row.topic3,
        row.data,
      ],
    );
  }
}

async function insertTokenTransfers(client: PoolClient, rows: TokenTransferRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO token_transfers (chain_id, tx_hash, log_index, token, "from", "to", value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chain_id, tx_hash, log_index)
       DO NOTHING`,
      [row.chainId, row.txHash, row.logIndex, row.token, row.from, row.to, row.value],
    );
  }
}

async function upsertCheckpoint(
  client: PoolClient,
  chainId: number,
  blockNumber: bigint,
): Promise<void> {
  await client.query(
    `INSERT INTO job_checkpoints (chain_id, last_block_scanned, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chain_id)
     DO UPDATE SET last_block_scanned = EXCLUDED.last_block_scanned, updated_at = NOW()`,
    [chainId, blockNumber.toString()],
  );
}
