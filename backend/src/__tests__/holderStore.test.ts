import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  InvalidTransferValueError,
  applyHolderDeltas,
  aggregateTransferDeltas,
  decodeTransferLogs,
  type RpcLog,
} from "../services/holderStore";

class MockClient {
  private store = new Map<string, string>();

  setBalance(chainId: number, token: string, holder: string, balance: string) {
    const key = this.key(chainId, token, holder);
    this.store.set(key, balance);
  }

  getBalance(chainId: number, token: string, holder: string): string | undefined {
    return this.store.get(this.key(chainId, token, holder));
  }

  private key(chainId: number, token: string, holder: string): string {
    return `${chainId}:${token.toLowerCase()}:${holder.toLowerCase()}`;
  }

  async query(text: string, params: unknown[]) {
    if (text.startsWith("SELECT holder, balance")) {
      const chainId = params[0] as number;
      const tokenBuffer = params[1] as Buffer;
      const token = `0x${tokenBuffer.toString("hex")}`;
      const holders = params[2] as Buffer[];
      const rows = holders
        .map((holderBuffer) => {
          const holder = `0x${holderBuffer.toString("hex")}`;
          const balance = this.getBalance(chainId, token, holder);
          if (balance === undefined) {
            return null;
          }
          return { holder: holderBuffer, balance };
        })
        .filter((row): row is { holder: Buffer; balance: string } => row !== null);

      return { rows };
    }

    if (text.startsWith("DELETE FROM token_holders")) {
      const chainId = params[0] as number;
      const token = `0x${(params[1] as Buffer).toString("hex")}`;
      const holder = `0x${(params[2] as Buffer).toString("hex")}`;
      this.store.delete(this.key(chainId, token, holder));
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("INSERT INTO token_holders")) {
      const chainId = params[0] as number;
      const token = `0x${(params[1] as Buffer).toString("hex")}`;
      const holder = `0x${(params[2] as Buffer).toString("hex")}`;
      const balance = params[3] as string;
      this.store.set(this.key(chainId, token, holder), balance);
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

function topicFor(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "");
  return `0x${hex.padStart(64, "0")}`;
}

function valueHex(amount: bigint): string {
  return `0x${amount.toString(16).padStart(64, "0")}`;
}

describe("holderStore", () => {
  it("applies transfer deltas to holder balances", async () => {
    const client = new MockClient();
    const chainId = 137;
    const token = "0x0000000000000000000000000000000000000abc";
    const holderA = "0x00000000000000000000000000000000000000a1";
    const holderB = "0x00000000000000000000000000000000000000b2";
    const holderC = "0x00000000000000000000000000000000000000c3";
    const holderD = "0x00000000000000000000000000000000000000d4";

    client.setBalance(chainId, token, holderA, "1000");

    const logs: RpcLog[] = [
      {
        address: token,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topicFor(holderA),
          topicFor(holderB),
        ],
        data: valueHex(100n),
      },
      {
        address: token,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topicFor("0x0000000000000000000000000000000000000000"),
          topicFor(holderC),
        ],
        data: valueHex(50n),
      },
      {
        address: token,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topicFor(holderB),
          topicFor(holderD),
        ],
        data: valueHex(25n),
      },
      {
        address: token,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topicFor(holderA),
          topicFor("0x0000000000000000000000000000000000000000"),
        ],
        data: valueHex(200n),
      },
    ];

    const transfers = decodeTransferLogs(logs);
    const deltas = aggregateTransferDeltas(transfers);
    const fakeClient = { query: client.query.bind(client) } as unknown as PoolClient;

    await applyHolderDeltas(fakeClient, chainId, token, deltas);

    expect(client.getBalance(chainId, token, holderA)).toBe("700");
    expect(client.getBalance(chainId, token, holderB)).toBe("75");
    expect(client.getBalance(chainId, token, holderC)).toBe("50");
    expect(client.getBalance(chainId, token, holderD)).toBe("25");
  });

  it("throws when transfer log value is invalid hex", () => {
    const token = "0x0000000000000000000000000000000000000abc";
    const holder = "0x00000000000000000000000000000000000000a1";

    const logs: RpcLog[] = [
      {
        address: token,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topicFor(holder),
          topicFor(holder),
        ],
        data: "0x",
      },
    ];

    expect(() => decodeTransferLogs(logs)).toThrow(InvalidTransferValueError);
  });
});
