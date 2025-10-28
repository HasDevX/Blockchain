import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AppFactory = (typeof import("../app"))["createApp"];

describe("API routes", () => {
  const TX_HASH = `0x${"aa".repeat(32)}`;
  const ADDRESS = `0x${"bb".repeat(20)}`;
  const TOKEN_ADDRESS = `0x${"cc".repeat(20)}`;

  let app: Awaited<ReturnType<AppFactory>>;
  let createApp: AppFactory;
  let getTransactionDetailsMock: ReturnType<typeof vi.fn>;
  let getAddressActivityMock: ReturnType<typeof vi.fn>;
  let getTokenChainCoverageMock: ReturnType<typeof vi.fn>;

  class MockInvalidTransactionHashError extends Error {}
  class MockUnsupportedChainError extends Error {}

  beforeEach(async () => {
    vi.resetModules();

    process.env.NODE_ENV = "test";
    process.env.FRONTEND_URL = "http://localhost:5173";
    process.env.REDIS_URL = "";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
    process.env.GIT_SHA = "ABCDEF1234567890";
    process.env.ADMIN_EMAIL = "admin@example.com";
    process.env.ADMIN_PASSWORD = "password";
    process.env.JWT_SECRET = "test-secret";

    getTransactionDetailsMock = vi.fn();
    getAddressActivityMock = vi.fn();
    getTokenChainCoverageMock = vi.fn();

    vi.doMock("../services/executionStore", () => ({
      getTransactionDetails: getTransactionDetailsMock,
      getAddressActivity: getAddressActivityMock,
      InvalidTransactionHashError: MockInvalidTransactionHashError,
    }));

    vi.doMock("../services/tokenService", () => ({
      getTokenChainCoverage: getTokenChainCoverageMock,
      getTokenHolders: vi.fn(),
      UnsupportedChainError: MockUnsupportedChainError,
    }));

    ({ createApp } = await import("../app"));
    app = await createApp();
  });

  describe("GET /api/tx/:hash", () => {
    it("returns transaction details when found", async () => {
      getTransactionDetailsMock.mockResolvedValue({
        chainId: 1,
        hash: TX_HASH,
        blockNumber: "100",
        blockHash: `0x${"dd".repeat(32)}`,
        timestamp: "2024-03-01T00:00:00.000Z",
        from: ADDRESS,
        to: null,
        value: "0",
        nonce: "1",
        gas: "21000",
        gasPrice: "1000000000",
        input: "0x",
        methodSignature: null,
        methodSelector: null,
        status: true,
        gasUsed: "21000",
        effectiveGasPrice: "1000000000",
        contractAddress: null,
        logs: [],
        tokenTransfers: [],
      });

      const response = await request(app).get(`/api/tx/${TX_HASH}`).query({ chainId: 1 });

      expect(response.status).toBe(200);
      expect(response.body.transaction.hash).toBe(TX_HASH);
      expect(getTransactionDetailsMock).toHaveBeenCalledWith(1, TX_HASH);
    });

    it("returns 404 when transaction is missing", async () => {
      getTransactionDetailsMock.mockResolvedValue(null);

      const response = await request(app).get(`/api/tx/${TX_HASH}`).query({ chainId: 1 });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "transaction_not_found" });
    });

    it("rejects invalid transaction hash", async () => {
      getTransactionDetailsMock.mockRejectedValue(new MockInvalidTransactionHashError("bad"));

      const response = await request(app).get(`/api/tx/${TX_HASH}`).query({ chainId: 1 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_hash" });
    });

    it("requires chain id parameter", async () => {
      const response = await request(app).get(`/api/tx/${TX_HASH}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "missing_chain" });
      expect(getTransactionDetailsMock).not.toHaveBeenCalled();
    });

    it("rejects unsupported chains", async () => {
      const response = await request(app).get(`/api/tx/${TX_HASH}`).query({ chainId: 25 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "unsupported_chain" });
      expect(getTransactionDetailsMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/address/:address/activity", () => {
    it("returns activity payload", async () => {
      getAddressActivityMock.mockResolvedValue({
        items: [
          {
            txHash: TX_HASH,
            logIndex: 0,
            blockNumber: "100",
            timestamp: "2024-03-01T00:00:00.000Z",
            token: TOKEN_ADDRESS,
            from: ADDRESS,
            to: ADDRESS,
            value: "10",
            direction: "in",
          },
        ],
        tokenTransfers: [
          {
            txHash: TX_HASH,
            logIndex: 0,
            blockNumber: "100",
            timestamp: "2024-03-01T00:00:00.000Z",
            token: TOKEN_ADDRESS,
            from: ADDRESS,
            to: ADDRESS,
            value: "10",
            direction: "in",
          },
        ],
        transactions: [
          {
            hash: TX_HASH,
            blockNumber: "100",
            timestamp: "2024-03-01T00:00:00.000Z",
            from: ADDRESS,
            to: ADDRESS,
            value: "0",
            status: true,
            tokenTransfers: [],
          },
        ],
        nextCursor: "cursor123",
      });

      const response = await request(app)
        .get(`/api/address/${ADDRESS}/activity`)
        .query({ chainId: 1, limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.nextCursor).toBe("cursor123");
      expect(getAddressActivityMock).toHaveBeenCalledWith({
        chainId: 1,
        address: ADDRESS,
        cursor: null,
        limit: 5,
      });
    });

    it("returns 400 for invalid address input", async () => {
      const error = new Error("invalid address format");
      getAddressActivityMock.mockRejectedValue(error);

      const response = await request(app)
        .get(`/api/address/${ADDRESS}/activity`)
        .query({ chainId: 1 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_address" });
    });

    it("validates chainId parameter", async () => {
      const response = await request(app)
        .get(`/api/address/${ADDRESS}/activity`)
        .query({ chainId: "not-an-int" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_chain" });
    });

    it("requires chainId query parameter", async () => {
      const response = await request(app).get(`/api/address/${ADDRESS}/activity`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "missing_chain" });
      expect(getAddressActivityMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/token/:address/chains", () => {
    it("returns chain coverage list", async () => {
      getTokenChainCoverageMock.mockResolvedValue([{ chainId: 1 }, { chainId: 137 }]);

      const response = await request(app).get(`/api/token/${TOKEN_ADDRESS}/chains`);

      expect(response.status).toBe(200);
      expect(response.body.chains).toEqual([{ chainId: 1 }, { chainId: 137 }]);
    });

    it("returns 400 for invalid token address", async () => {
      const error = new Error("invalid address provided");
      getTokenChainCoverageMock.mockRejectedValue(error);

      const response = await request(app).get(`/api/token/${TOKEN_ADDRESS}/chains`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_address" });
    });
  });
});
