import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TransactionPage } from "../Transaction";
import type { TransactionDetails } from "../../types/api";

vi.mock("react-hot-toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseTransaction = vi.fn();

vi.mock("../../hooks/useTransaction", () => ({
  useTransaction: (...args: unknown[]) => mockUseTransaction(...args),
}));

describe("TransactionPage", () => {
  beforeEach(() => {
    mockUseTransaction.mockReset();
  });

  it("renders transaction summary and transfers", () => {
    const transaction: TransactionDetails = {
      chainId: 1,
      hash: "0x".padEnd(66, "a"),
      blockNumber: "123456",
      blockHash: "0x".padEnd(66, "b"),
      timestamp: "2024-01-01T00:00:00Z",
      from: "0x".padEnd(42, "1"),
      to: "0x".padEnd(42, "2"),
      value: "1000000000000000000",
      nonce: "1",
      gas: "21000",
      gasPrice: "1000000000",
      input: "0xa9059cbb00000000000000000000000000000000000000000000000000000001",
      methodSignature: "transfer(address,uint256)",
      methodSelector: "0xa9059cbb",
      status: true,
      gasUsed: "21000",
      effectiveGasPrice: "1000000000",
      contractAddress: null,
      logs: [
        {
          index: 0,
          address: "0x".padEnd(42, "3"),
          topics: ["0x".padEnd(66, "4"), null, null, null],
          data: "0x01",
        },
      ],
      tokenTransfers: [
        {
          logIndex: 0,
          token: "0x".padEnd(42, "5"),
          from: "0x".padEnd(42, "1"),
          to: "0x".padEnd(42, "2"),
          value: "500",
        },
      ],
    };

    mockUseTransaction.mockReturnValue({ data: transaction, isLoading: false, error: null });

    render(
      <MemoryRouter initialEntries={[`/tx/${transaction.hash}?chainId=1`]}>
        <Routes>
          <Route path="/tx/:hash" element={<TransactionPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mockUseTransaction).toHaveBeenCalledWith(1, transaction.hash);
    expect(screen.getByText(/Chain 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Success/i)).toBeInTheDocument();
    expect(screen.getByText(/Token transfers/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer\(address,uint256\)/i)).toBeInTheDocument();
  });

  it("shows invalid path when chain id missing", () => {
    mockUseTransaction.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <MemoryRouter initialEntries={["/tx/0x".padEnd(66, "a")]}>
        <Routes>
          <Route path="/tx/:hash" element={<TransactionPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/Invalid transaction path/i)).toBeInTheDocument();
  });
});
