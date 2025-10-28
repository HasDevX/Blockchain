import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSpanHints } from "../workers/adaptiveSpan";
import type { ExecutionBatch } from "../services/executionStore";
import type { RpcBlock, RpcClient, RpcLogEntry, RpcTransactionReceipt } from "../lib/rpcClient";
import { ChainPoller } from "../workers/chainPoller";

process.env.CHAIN_POLLER_SKIP_AUTOSTART = "true";

const storeExecutionBatchMock = vi.fn<[ExecutionBatch], Promise<void>>(() => Promise.resolve());
const getCheckpointMock = vi.fn<[], Promise<bigint | null>>(() => Promise.resolve(null));

const rpcClientMock = {
  getBlockNumber: vi.fn<[], Promise<bigint>>(),
  getLogs: vi.fn<[], Promise<RpcLogEntry[]>>(),
  getBlockWithTransactions: vi.fn<[], Promise<RpcBlock | null>>(),
  getTransactionReceipt: vi.fn<[], Promise<RpcTransactionReceipt | null>>(),
  getBlockReceipts: vi.fn<[], Promise<RpcTransactionReceipt[] | null>>(),
};

describe("ChainPoller", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetSpanHints();
    storeExecutionBatchMock.mockImplementation(() => Promise.resolve());
    getCheckpointMock.mockImplementation(() => Promise.resolve(null));
    rpcClientMock.getBlockNumber.mockResolvedValue(2n);
    rpcClientMock.getLogs.mockResolvedValue([]);
    rpcClientMock.getBlockWithTransactions.mockResolvedValue(null);
    rpcClientMock.getTransactionReceipt.mockResolvedValue(null);
    rpcClientMock.getBlockReceipts.mockResolvedValue(null);
  });

  it("processes a confirmed block batch and populates transfers", async () => {
    const tokenAddress = "0x1234000000000000000000000000000000001234";
    const fromAddress = "0x00000000000000000000000000000000000000aa";
    const toAddress = "0x00000000000000000000000000000000000000bb";
    const txHash = "0x1111000000000000000000000000000000000000000000000000000000001111";
    const blockHash = "0x2222000000000000000000000000000000000000000000000000000000002222";
    const parentHash = "0x3333000000000000000000000000000000000000000000000000000000003333";

    const transferLog: RpcLogEntry = {
      address: tokenAddress,
      data: `0x${"64".padStart(64, "0")}`,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        padAddressTopic(fromAddress),
        padAddressTopic(toAddress),
      ],
      logIndex: "0x0",
      transactionHash: txHash,
    };

    rpcClientMock.getLogs.mockResolvedValue([transferLog]);

    const block: RpcBlock = {
      number: "0x1",
      hash: blockHash,
      parentHash,
      timestamp: "0x64",
      transactions: [
        {
          hash: txHash,
          from: fromAddress,
          to: toAddress,
          value: "0xde0b6b3a7640000",
          nonce: "0x1",
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
          input: "0x",
        },
      ],
    };

    rpcClientMock.getBlockWithTransactions.mockResolvedValue(block);

    const receipt: RpcTransactionReceipt = {
      transactionHash: txHash,
      status: "0x1",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: [transferLog],
    };

    rpcClientMock.getTransactionReceipt.mockResolvedValue(receipt);

    const poller = new ChainPoller(
      {
        chainId: 1,
        mode: "live",
        startBlock: 1n,
        confirmations: 1,
        pollIntervalMs: 1_000,
        targetBlock: null,
        useCheckpoint: false,
      },
      {
        rpcClient: rpcClientMock as unknown as RpcClient,
        storeBatch: storeExecutionBatchMock,
        getCheckpoint: getCheckpointMock,
      },
    );

    const didWork = await poller.processNextBatch();

    expect(didWork).toBe(true);
    expect(storeExecutionBatchMock).toHaveBeenCalledTimes(1);

    const batch = storeExecutionBatchMock.mock.calls[0]?.[0] as ExecutionBatch | undefined;
    expect(batch).toBeDefined();
    const ensuredBatch = batch!;
    expect(ensuredBatch.fromBlock).toBe(1n);
    expect(ensuredBatch.toBlock).toBe(1n);
    expect(ensuredBatch.blocks).toHaveLength(1);
    expect(ensuredBatch.transactions).toHaveLength(1);
    expect(ensuredBatch.receipts).toHaveLength(1);
    expect(ensuredBatch.logs).toHaveLength(1);
    expect(ensuredBatch.tokenTransfers).toHaveLength(1);
    expect(ensuredBatch.tokenTransfers[0]?.value).toBe("100");

    const deltas = ensuredBatch.holderDeltas[0]?.deltas;
    expect(deltas?.get(fromAddress.toLowerCase())).toBe(-100n);
    expect(deltas?.get(toAddress.toLowerCase())).toBe(100n);

    expect(rpcClientMock.getLogs).toHaveBeenCalledWith({
      fromBlock: 1n,
      toBlock: 1n,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
    });
    expect(rpcClientMock.getBlockReceipts).toHaveBeenCalledWith(blockHash);
    expect(rpcClientMock.getTransactionReceipt).toHaveBeenCalledWith(txHash);
  });

  it("prefers block receipts when RPC supports them", async () => {
    const tokenAddress = "0x1234000000000000000000000000000000001234";
    const fromAddress = "0x00000000000000000000000000000000000000aa";
    const toAddress = "0x00000000000000000000000000000000000000bb";
    const txHash = "0x4444000000000000000000000000000000000000000000000000000000004444";
    const blockHash = "0x5555000000000000000000000000000000000000000000000000000000005555";
    const parentHash = "0x6666000000000000000000000000000000000000000000000000000000006666";

    const transferLog: RpcLogEntry = {
      address: tokenAddress,
      data: `0x${"64".padStart(64, "0")}`,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        padAddressTopic(fromAddress),
        padAddressTopic(toAddress),
      ],
      logIndex: "0x0",
      transactionHash: txHash,
    };

    rpcClientMock.getLogs.mockResolvedValue([transferLog]);

    const block: RpcBlock = {
      number: "0x2",
      hash: blockHash,
      parentHash,
      timestamp: "0x65",
      transactions: [
        {
          hash: txHash,
          from: fromAddress,
          to: toAddress,
          value: "0xde0b6b3a7640000",
          nonce: "0x2",
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
          input: "0x",
        },
      ],
    };

    rpcClientMock.getBlockWithTransactions.mockResolvedValue(block);

    const receipt: RpcTransactionReceipt = {
      transactionHash: txHash,
      status: "0x1",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: [transferLog],
    };

    rpcClientMock.getBlockReceipts.mockResolvedValue([receipt]);

    const poller = new ChainPoller(
      {
        chainId: 1,
        mode: "live",
        startBlock: 1n,
        confirmations: 1,
        pollIntervalMs: 1_000,
        targetBlock: null,
        useCheckpoint: false,
      },
      {
        rpcClient: rpcClientMock as unknown as RpcClient,
        storeBatch: storeExecutionBatchMock,
        getCheckpoint: getCheckpointMock,
      },
    );

    const didWork = await poller.processNextBatch();

    expect(didWork).toBe(true);
    expect(rpcClientMock.getTransactionReceipt).not.toHaveBeenCalled();
    expect(rpcClientMock.getBlockReceipts).toHaveBeenCalledWith(blockHash);
    expect(storeExecutionBatchMock).toHaveBeenCalledTimes(1);
  });
});

function padAddressTopic(address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  return `0x${normalized.padStart(64, "0")}`;
}
