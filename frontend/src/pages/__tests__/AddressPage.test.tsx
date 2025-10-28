import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AddressPage } from "../Address";
import type { AddressActivityResponse } from "../../types/api";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseAddressActivity = vi.fn();

vi.mock("../../hooks/useAddressActivity", () => ({
  useAddressActivity: (...args: unknown[]) => mockUseAddressActivity(...args),
}));

describe("AddressPage", () => {
  beforeEach(() => {
    mockUseAddressActivity.mockReset();
  });

  it("renders activity table with transfers", () => {
    const response: AddressActivityResponse = {
      items: [
        {
          txHash: "0x".padEnd(66, "a"),
          logIndex: 1,
          blockNumber: "123",
          timestamp: "2024-01-01T00:00:00Z",
          token: "0x".padEnd(42, "1"),
          from: "0x".padEnd(42, "2"),
          to: "0x".padEnd(42, "3"),
          value: "100",
          direction: "in",
        },
      ],
      tokenTransfers: [
        {
          txHash: "0x".padEnd(66, "a"),
          logIndex: 1,
          blockNumber: "123",
          timestamp: "2024-01-01T00:00:00Z",
          token: "0x".padEnd(42, "1"),
          from: "0x".padEnd(42, "2"),
          to: "0x".padEnd(42, "3"),
          value: "100",
          direction: "in",
        },
      ],
      transactions: [
        {
          hash: "0x".padEnd(66, "a"),
          blockNumber: "123",
          timestamp: "2024-01-01T00:00:00Z",
          from: "0x".padEnd(42, "2"),
          to: "0x".padEnd(42, "3"),
          value: "200",
          status: true,
          tokenTransfers: [],
        },
      ],
      nextCursor: "cursor-2",
    };

    mockUseAddressActivity.mockReturnValue({
      data: response,
      isLoading: false,
      error: null,
      isValidating: false,
    });

    const address = "0x".padEnd(42, "a");

    render(
      <MemoryRouter initialEntries={[`/address/${address}?chainId=1`]}>
        <Routes>
          <Route path="/address/:address" element={<AddressPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mockUseAddressActivity).toHaveBeenCalledWith(1, address.toLowerCase(), {
      cursor: null,
      limit: 25,
    });

    expect(screen.getByText(/Incoming transfers/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent activity/i)).toBeInTheDocument();
    expect(screen.getByText(/^In$/i)).toBeInTheDocument();
    expect(screen.getByText(/Next/i)).toBeInTheDocument();
  });

  it("renders invalid path message when chain id missing", () => {
    mockUseAddressActivity.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <MemoryRouter initialEntries={["/address/0x".padEnd(42, "a")]}>
        <Routes>
          <Route path="/address/:address" element={<AddressPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Invalid address path\./i)).toBeInTheDocument();
  });
});
