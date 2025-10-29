import { describe, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SWRConfig } from "swr";
import { AuthProvider } from "../../contexts/AuthContext";
import { AdminConnectionsPage } from "../AdminConnections";
import {
  ApiError,
  createAdminEndpoint,
  updateAdminEndpoint,
  disableAdminEndpoint,
  testAdminRpc,
} from "../../lib/api";
import { useAdminConnections } from "../../hooks/useAdminConnections";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");

  return {
    ...actual,
    fetchAdminConnections: vi.fn(),
    createAdminEndpoint: vi.fn(),
    updateAdminEndpoint: vi.fn(),
    disableAdminEndpoint: vi.fn(),
    testAdminRpc: vi.fn(),
  };
});

vi.mock("../../hooks/useAdminConnections", () => ({
  useAdminConnections: vi.fn(),
}));

const createEndpointMock = createAdminEndpoint as unknown as ReturnType<typeof vi.fn>;
const updateEndpointMock = updateAdminEndpoint as unknown as ReturnType<typeof vi.fn>;
const disableEndpointMock = disableAdminEndpoint as unknown as ReturnType<typeof vi.fn>;
const testRpcMock = testAdminRpc as unknown as ReturnType<typeof vi.fn>;
const useAdminConnectionsMock = useAdminConnections as unknown as ReturnType<typeof vi.fn>;

let mutateMock: ReturnType<typeof vi.fn>;
let consoleErrorSpy: MockInstance<[message?: unknown, ...optionalParams: unknown[]], void>;

const originalConsoleError = console.error;

const SAMPLE_CONNECTIONS = {
  chains: [
    {
      chainId: 1,
      name: "Ethereum",
      endpoints: [
        {
          id: "endpoint-1",
          chainId: 1,
          url: "https://rpc-mainnet.example",
          isPrimary: true,
          enabled: true,
          qps: 12,
          minSpan: 8,
          maxSpan: 1000,
          weight: 2,
          orderIndex: 0,
          lastHealth: "ok",
          lastCheckedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/connections"]}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthProvider>
          <Routes>
            <Route path="/admin/connections" element={<AdminConnectionsPage />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </AuthProvider>
      </SWRConfig>
    </MemoryRouter>,
  );
}

describe("AdminConnectionsPage", () => {
  beforeEach(() => {
    createEndpointMock.mockReset();
    updateEndpointMock.mockReset();
    disableEndpointMock.mockReset();
    testRpcMock.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("explorer-token-auth", "test-token");
    mutateMock = vi.fn().mockResolvedValue(SAMPLE_CONNECTIONS);
    useAdminConnectionsMock.mockReset();
    useAdminConnectionsMock.mockReturnValue({
      data: SAMPLE_CONNECTIONS,
      isLoading: false,
      error: undefined,
      mutate: mutateMock,
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message, ...args) => {
      if (typeof message === "string" && message.includes("not wrapped in act")) {
        return;
      }
      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders chain endpoints", async () => {
    renderPage();

    expect(await screen.findByText(/chain connections/i)).toBeInTheDocument();
    expect(screen.getByText(/ethereum/i)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/rpc-mainnet\.example/i)).toBeInTheDocument();
  });

  it("submits new endpoint payload", async () => {
    const user = userEvent.setup();
    createEndpointMock.mockResolvedValue({
      id: "endpoint-2",
      chainId: 1,
      url: "https://rpc-new.example",
      isPrimary: false,
      enabled: true,
      qps: 10,
      minSpan: 8,
      maxSpan: 1000,
      weight: 1,
      orderIndex: 0,
      lastHealth: null,
      lastCheckedAt: null,
      updatedAt: new Date().toISOString(),
    });
    mutateMock.mockReturnValueOnce(new Promise(() => {}));

    renderPage();

    const addButton = await screen.findByRole("button", { name: /add endpoint/i });
    await act(async () => {
      await user.click(addButton);
    });
    await user.clear(screen.getByLabelText(/endpoint url/i));
    await user.type(screen.getByLabelText(/endpoint url/i), "https://rpc-new.example");
    await user.clear(screen.getByLabelText(/requests per second/i));
    await user.type(screen.getByLabelText(/requests per second/i), "25");
    await user.click(screen.getByLabelText(/primary endpoint/i));

    const createButton = screen.getByRole("button", { name: /create/i });
    await act(async () => {
      await user.click(createButton);
    });

    await waitFor(() => {
      expect(createEndpointMock).toHaveBeenCalledWith(
        1,
        {
          url: "https://rpc-new.example",
          isPrimary: true,
          enabled: true,
          qps: 25,
          minSpan: 8,
          maxSpan: 1000,
          weight: 1,
          orderIndex: 0,
        },
        "test-token",
      );
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });
  });

  it("updates an endpoint", async () => {
    const user = userEvent.setup();
    updateEndpointMock.mockResolvedValue({
      ...SAMPLE_CONNECTIONS.chains[0].endpoints[0],
      weight: 3,
    });
    mutateMock.mockReturnValueOnce(new Promise(() => {}));

    renderPage();

    const editButton = await screen.findByRole("button", { name: /edit/i });
    await act(async () => {
      await user.click(editButton);
    });
    const weightInput = screen.getByLabelText(/weight/i);
    await user.clear(weightInput);
    await user.type(weightInput, "3");

    const saveButton = screen.getByRole("button", { name: /save changes/i });
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => {
      expect(updateEndpointMock).toHaveBeenCalledWith(
        1,
        "endpoint-1",
        {
          weight: 3,
        },
        "test-token",
      );
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });
  });

  it("disables an endpoint when confirmed", async () => {
    const user = userEvent.setup();
    disableEndpointMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mutateMock.mockReturnValueOnce(new Promise(() => {}));

    renderPage();

    const disableButton = await screen.findByRole("button", { name: /disable/i });
    await act(async () => {
      await user.click(disableButton);
    });

    await waitFor(() => {
      expect(disableEndpointMock).toHaveBeenCalledWith(1, "endpoint-1", "test-token");
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it("tests an endpoint over rpc", async () => {
    const user = userEvent.setup();
    testRpcMock.mockResolvedValue({ ok: true, tip: "0x10", latencyMs: 120 });

    renderPage();

    const testButton = await screen.findByRole("button", { name: /test/i });
    await act(async () => {
      await user.click(testButton);
    });

    await waitFor(() => {
      expect(testRpcMock).toHaveBeenCalledWith(
        { url: "https://rpc-mainnet.example", chainId: 1, endpointId: "endpoint-1" },
        "test-token",
      );
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalled();
    });
  });

  it("redirects to login on unauthorized error", async () => {
    const unauthorizedMutate = vi.fn();
    useAdminConnectionsMock.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: new ApiError("Unauthorized", 401, {}),
      mutate: unauthorizedMutate,
    });

    renderPage();

    await screen.findByText(/login page/i);
  });
});
