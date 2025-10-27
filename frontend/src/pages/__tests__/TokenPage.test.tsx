import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TokenPage } from "../Token";
import type { TokenHolder, TokenSummary } from "../../types/api";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

const mockUseToken = vi.fn();
const mockUseTokenHolders = vi.fn();

vi.mock("../../hooks/useToken", () => ({
  useToken: (...args: unknown[]) => mockUseToken(...args),
}));

vi.mock("../../hooks/useTokenHolders", () => ({
  useTokenHolders: (...args: unknown[]) => mockUseTokenHolders(...args),
}));

describe("TokenPage", () => {
  beforeEach(() => {
    mockUseToken.mockReset();
    mockUseTokenHolders.mockReset();
  });

  it("requests holders using query chain id", async () => {
    const tokenSummary: TokenSummary = {
      chainId: 137,
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      name: "Sample Token",
      symbol: "SAMP",
      priceUsd: 1.23,
      totalSupply: "1000000000000000000000000",
      holdersCount: 1284,
      supported: true,
      explorerUrl: "https://example.com",
    };

    const holders: TokenHolder[] = [
      { rank: 1, address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", balance: "1000", percentage: 12.34 },
      { rank: 2, address: "0x123", balance: "500", percentage: 6.17 },
    ];

    mockUseToken.mockReturnValue({ data: tokenSummary, isLoading: false, error: null });
    mockUseTokenHolders.mockReturnValue({ data: { items: holders, nextCursor: "25" }, isLoading: false, error: null });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/token/0xABCDEFabcdefabcdefabcdefabcdefabcdefABCD?chainId=137"]}>
          <Routes>
            <Route path="/token/:address" element={<TokenPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(mockUseToken).toHaveBeenCalledWith(137, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");

    const lastCall = mockUseTokenHolders.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(137);
    expect(lastCall?.[1]).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(lastCall?.[2]).toMatchObject({ cursor: null, limit: 25 });

  const holdersTab = screen.getByRole("tab", { name: /holders/i });
    await act(async () => {
      await userEvent.click(holdersTab);
    });

    expect(await screen.findByText(/Top holders/i)).toBeInTheDocument();
    expect(screen.getByText(/Page size 25/i)).toBeInTheDocument();
  });

  it("shows invalid path message when chain id missing", async () => {
    mockUseToken.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseTokenHolders.mockReturnValue({ data: null, isLoading: false, error: null });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/token/0xabc"]}>
          <Routes>
            <Route path="/token/:address" element={<TokenPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.getByText(/Invalid token path/i)).toBeInTheDocument();
  });
});
