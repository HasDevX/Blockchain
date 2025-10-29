import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Pool } from "pg";
import type {
  ChainConfigRecord,
  ChainEndpointRecord,
  IndexJobRecord,
} from "../services/chainConfigService";

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
    endpoints: [],
  };

  const chainEndpointRecord: ChainEndpointRecord = {
    id: "endpoint-1",
    chainId: 137,
    label: "Primary RPC",
    url: "https://polygon-rpc.second",
    isPrimary: true,
    enabled: true,
    qps: 10,
    minSpan: 8,
    maxSpan: 1000,
    weight: 1,
    orderIndex: 0,
    lastHealth: "ok",
    lastCheckedAt: new Date("2024-01-01T00:05:00.000Z"),
    updatedAt: new Date("2024-01-01T00:10:00.000Z"),
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
  let listAllChainEndpointsMock: ReturnType<typeof vi.fn>;
  let createChainEndpointMock: ReturnType<typeof vi.fn>;
  let getChainEndpointMock: ReturnType<typeof vi.fn>;
  let updateChainEndpointMock: ReturnType<typeof vi.fn>;
  let findChainEndpointByUrlMock: ReturnType<typeof vi.fn>;
  let disableChainEndpointMock: ReturnType<typeof vi.fn>;
  let invalidateChainConfigCacheMock: ReturnType<typeof vi.fn>;
  let unsetPrimaryForOtherEndpointsMock: ReturnType<typeof vi.fn>;
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
    listAllChainEndpointsMock = vi.fn(async () => [chainEndpointRecord]);
    createChainEndpointMock = vi.fn(async () => ({
      ...chainEndpointRecord,
      label: null,
      id: "endpoint-2",
      url: "https://polygon-rpc.new",
      isPrimary: false,
      qps: 1,
      minSpan: 8,
      maxSpan: 1000,
      weight: 1,
      orderIndex: 0,
      lastHealth: null,
      lastCheckedAt: null,
      updatedAt: new Date("2024-01-01T00:20:00.000Z"),
    }));
    getChainEndpointMock = vi.fn(async () => chainEndpointRecord);
    updateChainEndpointMock = vi.fn(async () => ({
      ...chainEndpointRecord,
      qps: 20,
      label: "Primary RPC",
      maxSpan: 1200,
      updatedAt: new Date("2024-01-01T00:30:00.000Z"),
    }));
    findChainEndpointByUrlMock = vi.fn(async () => chainEndpointRecord);
    disableChainEndpointMock = vi.fn(async () => ({
      ...chainEndpointRecord,
      label: "Primary RPC",
      enabled: false,
      updatedAt: new Date("2024-01-01T00:40:00.000Z"),
    }));
    enqueueReindexMock = vi.fn(async () => undefined);
    unsetPrimaryForOtherEndpointsMock = vi.fn(async () => undefined);
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
    invalidateChainConfigCacheMock = vi.fn();

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
      listAllChainEndpoints: listAllChainEndpointsMock,
      createChainEndpoint: createChainEndpointMock,
      getChainEndpoint: getChainEndpointMock,
      updateChainEndpoint: updateChainEndpointMock,
  findChainEndpointByUrl: findChainEndpointByUrlMock,
      disableChainEndpoint: disableChainEndpointMock,
      unsetPrimaryForOtherEndpoints: unsetPrimaryForOtherEndpointsMock,
    }));

    vi.doMock("../services/tokenHolderRepository", () => ({
      enqueueReindex: enqueueReindexMock,
    }));

    vi.doMock("../services/adminDashboardService", () => ({
      getAdminStatus: getAdminStatusMock,
      summarizeJobs: summarizeJobsMock,
    }));

    vi.doMock("../services/chainConfigProvider", () => ({
      invalidateChainConfigCache: invalidateChainConfigCacheMock,
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

  describe("GET /api/admin/connections", () => {
    it("requires authentication", async () => {
      const response = await request(app).get("/api/admin/connections");
      expect(response.status).toBe(401);
    });

    it("returns serialized chains and endpoints", async () => {
      const response = await request(app)
        .get("/api/admin/connections")
        .set("Authorization", authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        chains: [
          {
            chain_id: 137,
            name: "Polygon",
            endpoints: [
              {
                id: "endpoint-1",
                chain_id: 137,
                label: "Primary RPC",
                url: "https://polygon-rpc.second",
                is_primary: true,
                enabled: true,
                qps: 10,
                min_span: 8,
                max_span: 1000,
                weight: 1,
                order_index: 0,
                last_health: "ok",
                last_checked_at: "2024-01-01T00:05:00.000Z",
                updated_at: "2024-01-01T00:10:00.000Z",
              },
            ],
          },
        ],
      });
      expect(fetchChainConfigsMock).toHaveBeenCalled();
      expect(listAllChainEndpointsMock).toHaveBeenCalledWith({ includeDisabled: true });
    });
  });

  describe("POST /api/admin/chains/:chainId/endpoints", () => {
    it("requires authentication", async () => {
      const response = await request(app).post("/api/admin/chains/137/endpoints");
      expect(response.status).toBe(401);
      expect(createChainEndpointMock).not.toHaveBeenCalled();
    });

    it("creates endpoint with defaults and invalidates cache", async () => {
      const response = await request(app)
        .post("/api/admin/chains/137/endpoints")
        .set("Authorization", authHeader)
        .send({ url: "https://polygon-rpc.new" });

      expect(response.status).toBe(201);
      expect(createChainEndpointMock).toHaveBeenCalledWith(137, {
        url: "https://polygon-rpc.new",
        label: null,
        isPrimary: false,
        enabled: true,
        qps: 1,
        minSpan: 8,
        maxSpan: 1000,
        weight: 1,
        orderIndex: 0,
      });
      expect(invalidateChainConfigCacheMock).toHaveBeenCalled();
      expect(unsetPrimaryForOtherEndpointsMock).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        endpoint: {
          id: "endpoint-2",
          chain_id: 137,
          label: null,
          url: "https://polygon-rpc.new",
          is_primary: false,
          enabled: true,
          qps: 1,
          min_span: 8,
          max_span: 1000,
          weight: 1,
          order_index: 0,
          last_health: null,
          last_checked_at: null,
          updated_at: "2024-01-01T00:20:00.000Z",
        },
      });
    });
  });

  describe("PUT /api/admin/chains/:chainId/endpoints/:endpointId", () => {
    it("requires authentication", async () => {
      const response = await request(app).put("/api/admin/chains/137/endpoints/endpoint-1");
      expect(response.status).toBe(401);
      expect(updateChainEndpointMock).not.toHaveBeenCalled();
    });

    it("validates existence and updates endpoint", async () => {
      const response = await request(app)
        .put("/api/admin/chains/137/endpoints/endpoint-1")
        .set("Authorization", authHeader)
        .send({ qps: 20, max_span: 1200 });

      expect(response.status).toBe(200);
      expect(getChainEndpointMock).toHaveBeenCalledWith(137, "endpoint-1");
      expect(updateChainEndpointMock).toHaveBeenCalledWith(137, "endpoint-1", {
        qps: 20,
        maxSpan: 1200,
      });
      expect(invalidateChainConfigCacheMock).toHaveBeenCalled();
      expect(unsetPrimaryForOtherEndpointsMock).not.toHaveBeenCalled();
      expect(response.body).toEqual({
        endpoint: {
          id: "endpoint-1",
          chain_id: 137,
          label: "Primary RPC",
          url: "https://polygon-rpc.second",
          is_primary: true,
          enabled: true,
          qps: 20,
          min_span: 8,
          max_span: 1200,
          weight: 1,
          order_index: 0,
          last_health: "ok",
          last_checked_at: "2024-01-01T00:05:00.000Z",
          updated_at: "2024-01-01T00:30:00.000Z",
        },
      });
    });

    it("returns 404 when endpoint missing", async () => {
      getChainEndpointMock.mockResolvedValueOnce(null);

      const response = await request(app)
        .put("/api/admin/chains/137/endpoints/unknown")
        .set("Authorization", authHeader)
        .send({ qps: 20 });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "endpoint_not_found" });
    });
  });

  describe("DELETE /api/admin/chains/:chainId/endpoints/:endpointId", () => {
    it("requires authentication", async () => {
      const response = await request(app).delete("/api/admin/chains/137/endpoints/endpoint-1");
      expect(response.status).toBe(401);
      expect(disableChainEndpointMock).not.toHaveBeenCalled();
    });

    it("disables endpoint and invalidates cache", async () => {
      const response = await request(app)
        .delete("/api/admin/chains/137/endpoints/endpoint-1")
        .set("Authorization", authHeader);

      expect(response.status).toBe(204);
      expect(disableChainEndpointMock).toHaveBeenCalledWith(137, "endpoint-1");
      expect(invalidateChainConfigCacheMock).toHaveBeenCalled();
    });

    it("returns 404 when endpoint missing", async () => {
      disableChainEndpointMock.mockResolvedValueOnce(null);

      const response = await request(app)
        .delete("/api/admin/chains/137/endpoints/unknown")
        .set("Authorization", authHeader);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "endpoint_not_found" });
    });
  });

  describe("POST /api/admin/test-rpc", () => {
    it("requires authentication", async () => {
      const response = await request(app).post("/api/admin/test-rpc");
      expect(response.status).toBe(401);
    });

    it("returns latency and tip on success", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      fetchSpy.mockImplementation(async () => {
        vi.advanceTimersByTime(600);
        return {
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x10" }),
        } as unknown;
      });

      try {
        const response = await request(app)
          .post("/api/admin/test-rpc")
          .set("Authorization", authHeader)
          .send({ url: "https://rpc.example", chainId: 137, endpointId: "endpoint-1" });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ ok: true, tip: "0x10", latency_ms: 600 });
        expect(fetchSpy).toHaveBeenCalledWith("https://rpc.example", expect.anything());
        expect(getChainEndpointMock).toHaveBeenCalledWith(137, "endpoint-1");
        expect(updateChainEndpointMock).toHaveBeenCalledWith(
          137,
          "endpoint-1",
          expect.objectContaining({
            lastHealth: "tip 0x10",
            lastCheckedAt: expect.any(Date),
          }),
        );
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it("returns http error payload when rpc rejects", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      } as unknown);

      const response = await request(app)
        .post("/api/admin/test-rpc")
        .set("Authorization", authHeader)
        .send({ url: "https://rpc.example", chainId: 137, endpointId: "endpoint-1" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: false, error: "http_error", status: 500 });
      expect(updateChainEndpointMock).toHaveBeenCalledWith(
        137,
        "endpoint-1",
        expect.objectContaining({
          lastHealth: "http_error:500",
          lastCheckedAt: expect.any(Date),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("maps network errors", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      fetchSpy.mockRejectedValueOnce(new Error("boom"));

      const response = await request(app)
        .post("/api/admin/test-rpc")
        .set("Authorization", authHeader)
        .send({ url: "https://rpc.example", chainId: 137, endpointId: "endpoint-1" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: false, error: "timeout", message: "boom" });
      expect(updateChainEndpointMock).toHaveBeenCalledWith(
        137,
        "endpoint-1",
        expect.objectContaining({
          lastHealth: "timeout",
          lastCheckedAt: expect.any(Date),
        }),
      );

      vi.unstubAllGlobals();
    });
  });
});
