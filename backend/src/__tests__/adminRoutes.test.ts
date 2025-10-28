import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pool } from "pg";
import type { ChainConfigRecord, IndexJobRecord } from "../services/chainConfigService";

describe("Admin API routes", () => {
  const chainConfigRecord: ChainConfigRecord = {
    chainId: 137,
    name: "Polygon",
    enabled: true,
    rpcUrl: "https://polygon-rpc",
    rpcSource: "database",
    etherscanApiKey: null,
    etherscanSource: "none",
    startBlock: 0n,
    qps: 5,
    minSpan: 10,
    maxSpan: 100,
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };

  const chainConfigSummary = {
    chainId: 137,
    name: "Polygon",
    enabled: true,
    startBlock: "0",
    qps: 5,
    minSpan: 10,
    maxSpan: 100,
    updatedAt: "2024-01-01T00:00:00.000Z",
    rpc: {
      hasValue: true,
      masked: "•••• (len 17)",
      source: "database" as const,
    },
    etherscan: {
      hasValue: false,
      masked: null,
      source: "none" as const,
    },
  };

  const indexJobRecord: IndexJobRecord = {
    id: "job-1",
    chainId: 137,
    tokenAddress: "0xabcdef",
    fromBlock: 1000n,
    status: "queued",
    createdAt: new Date("2024-01-01T01:00:00.000Z"),
    error: null,
  };

  const jobSummary = {
    id: "job-1",
    chainId: 137,
    tokenAddress: "0xabcd••••cdef",
    fromBlock: "1000",
    status: "queued" as const,
    createdAt: "2024-01-01T01:00:00.000Z",
    error: null,
  };

  let fetchChainConfigsMock: ReturnType<typeof vi.fn>;
  let fetchChainConfigMock: ReturnType<typeof vi.fn>;
  let toChainConfigSummaryMock: ReturnType<typeof vi.fn>;
  let upsertChainConfigMock: ReturnType<typeof vi.fn>;
  let createIndexJobMock: ReturnType<typeof vi.fn>;
  let enqueueReindexMock: ReturnType<typeof vi.fn>;
  let getAdminStatusMock: ReturnType<typeof vi.fn>;
  let summarizeJobsMock: ReturnType<typeof vi.fn>;
  let withTransactionMock: ReturnType<typeof vi.fn>;
  let createApp: (typeof import("../app"))["createApp"];
  let app: Awaited<ReturnType<typeof createApp>>;
  let authHeader: string;

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

    fetchChainConfigsMock = vi.fn(async () => [chainConfigRecord]);
    fetchChainConfigMock = vi.fn(async () => chainConfigRecord);
    toChainConfigSummaryMock = vi.fn(() => [chainConfigSummary]);
    upsertChainConfigMock = vi.fn(async () => chainConfigRecord);
    createIndexJobMock = vi.fn(async () => indexJobRecord);
    enqueueReindexMock = vi.fn(async () => undefined);
    getAdminStatusMock = vi.fn(async () => ({
      chains: [
        {
          chainId: 137,
          name: "Polygon",
          enabled: true,
          qps: 5,
          span: { min: 10, max: 100 },
          lastSyncedBlock: "990",
          tipBlock: "1000",
          lagBlocks: "10",
          workerState: "running" as const,
          lastError: null,
          rpcHealthy: true,
          rpcMessage: null,
        },
      ],
      configs: [chainConfigSummary],
      jobs: [jobSummary],
    }));
    summarizeJobsMock = vi.fn(() => [jobSummary]);
    withTransactionMock = vi.fn(async (handler: (client: unknown) => Promise<unknown>) => {
      return handler({});
    });

    vi.doMock("../lib/db", () => ({
      getPool: vi.fn(() => ({}) as unknown as Pool),
      withTransaction: withTransactionMock,
    }));

    vi.doMock("../services/chainConfigService", () => ({
      fetchChainConfigs: fetchChainConfigsMock,
      fetchChainConfig: fetchChainConfigMock,
      toChainConfigSummary: toChainConfigSummaryMock,
      upsertChainConfig: upsertChainConfigMock,
      createIndexJob: createIndexJobMock,
    }));

    vi.doMock("../services/tokenHolderRepository", () => ({
      enqueueReindex: enqueueReindexMock,
    }));

    vi.doMock("../services/adminDashboardService", () => ({
      getAdminStatus: getAdminStatusMock,
      summarizeJobs: summarizeJobsMock,
    }));

    ({ createApp } = await import("../app"));
    app = await createApp();

    const token = jwt.sign({ sub: "admin", email: "admin@example.com" }, process.env.JWT_SECRET!);
    authHeader = `Bearer ${token}`;
  });

  describe("GET /api/admin/chain-configs", () => {
    it("requires authentication", async () => {
      const response = await request(app).get("/api/admin/chain-configs");
      expect(response.status).toBe(401);
    });

    it("returns chain configuration summaries", async () => {
      const response = await request(app)
        .get("/api/admin/chain-configs")
        .set("Authorization", authHeader);

      expect(response.status).toBe(200);
      expect(response.body.configs).toEqual([chainConfigSummary]);
      expect(fetchChainConfigsMock).toHaveBeenCalled();
      expect(toChainConfigSummaryMock).toHaveBeenCalledWith([chainConfigRecord]);
    });
  });

  describe("PUT /api/admin/chain-configs/:chainId", () => {
    it("validates span constraints", async () => {
      const response = await request(app)
        .put("/api/admin/chain-configs/137")
        .set("Authorization", authHeader)
        .send({ minSpan: 50, maxSpan: 10 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "span_mismatch" });
      expect(upsertChainConfigMock).not.toHaveBeenCalled();
    });

    it("updates configuration and returns masked summary", async () => {
      const response = await request(app)
        .put("/api/admin/chain-configs/137")
        .set("Authorization", authHeader)
        .send({ qps: 10, maxSpan: 200 });

      expect(response.status).toBe(200);
      expect(response.body.config).toEqual(chainConfigSummary);
      expect(fetchChainConfigMock).toHaveBeenCalledWith(137, expect.anything());
      expect(upsertChainConfigMock).toHaveBeenCalledWith(
        137,
        expect.objectContaining({ qps: 10, maxSpan: 200 }),
        expect.anything(),
      );
    });
  });

  describe("POST /api/admin/index-jobs", () => {
    it("requires authentication", async () => {
      const response = await request(app).post("/api/admin/index-jobs");
      expect(response.status).toBe(401);
    });

    it("validates input", async () => {
      const response = await request(app)
        .post("/api/admin/index-jobs")
        .set("Authorization", authHeader)
        .send({ chainId: 137, tokenAddress: "0xabc" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "invalid_token" });
    });

    it("enqueues job and returns summary", async () => {
      const response = await request(app)
        .post("/api/admin/index-jobs")
        .set("Authorization", authHeader)
        .send({ chainId: 137, tokenAddress: "0x" + "a".repeat(40), fromBlock: "1000" });

      expect(response.status).toBe(201);
      expect(enqueueReindexMock).toHaveBeenCalled();
      expect(createIndexJobMock).toHaveBeenCalled();
      expect(response.body.job).toEqual(jobSummary);
      expect(summarizeJobsMock).toHaveBeenCalledWith([indexJobRecord]);
      expect(withTransactionMock).toHaveBeenCalled();
    });
  });

  describe("GET /api/admin/status", () => {
    it("requires authentication", async () => {
      const response = await request(app).get("/api/admin/status");
      expect(response.status).toBe(401);
    });

    it("returns status payload", async () => {
      const response = await request(app).get("/api/admin/status").set("Authorization", authHeader);

      expect(response.status).toBe(200);
      expect(response.body.chains).toHaveLength(1);
      expect(response.body.jobs).toHaveLength(1);
      expect(getAdminStatusMock).toHaveBeenCalled();
    });
  });
});
