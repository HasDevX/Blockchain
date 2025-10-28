import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Copyable } from "../components/Copyable";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { Table } from "../components/Table";
import { useTransaction } from "../hooks/useTransaction";
import { formatNumber, truncateAddress } from "../lib/format";
import { getChainMetadataById } from "../lib/chainMetadata";
import type { TokenTransferEntry, TransactionLog } from "../types/api";

const METHOD_SIGNATURES: Record<string, string> = {
  "0xa9059cbb": "transfer(address,uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x18160ddd": "totalSupply()",
  "0x70a08231": "balanceOf(address)",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "medium",
});

const WEI = 1_000_000_000_000_000_000n;
const GWEI = 1_000_000_000n;
const TRANSFER_PAGE_SIZE = 25;
const LOG_PAGE_SIZE = 25;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  try {
    return DATE_FORMATTER.format(new Date(value));
  } catch (error) {
    console.warn("Invalid timestamp", error);
    return value;
  }
}

function formatWeiToEther(value: string | null): string {
  if (!value) {
    return "—";
  }

  try {
    const wei = BigInt(value);
    const whole = wei / WEI;
    const fraction = wei % WEI;
    const fractionString = fraction.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return fractionString ? `${whole}.${fractionString} ETH` : `${whole} ETH`;
  } catch (error) {
    console.warn("Unable to format wei", error);
    return value;
  }
}

function formatWeiToGwei(value: string | null): string {
  if (!value) {
    return "—";
  }

  try {
    const amount = BigInt(value);
    const whole = amount / GWEI;
    const fraction = amount % GWEI;
    const fractionString = fraction.toString().padStart(9, "0").slice(0, 4).replace(/0+$/, "");
    return fractionString ? `${whole}.${fractionString} Gwei` : `${whole} Gwei`;
  } catch (error) {
    console.warn("Unable to format gwei", error);
    return value;
  }
}

function decodeMethod(input: string | null): {
  label: string;
  selector: string | null;
} {
  if (!input || input === "0x" || input === "0x0") {
    return { label: "No calldata", selector: null };
  }

  const selector = input.slice(0, 10).toLowerCase();
  const known = METHOD_SIGNATURES[selector];

  if (known) {
    return { label: known, selector };
  }

  return { label: "Unknown method", selector };
}

function buildExplorerLink(chainId: number, txHash: string): string | null {
  const chain = getChainMetadataById(chainId);
  if (!chain?.explorerUrl) {
    return null;
  }

  return `${chain.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

export function TransactionPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const hash = params.hash ? decodeURIComponent(params.hash).toLowerCase() : null;
  const chainIdParam = searchParams.get("chainId");
  const parsedChainId = chainIdParam ? Number(chainIdParam) : NaN;
  const chainId = Number.isFinite(parsedChainId) ? parsedChainId : null;

  const transactionQuery = useTransaction(chainId, hash);
  const transaction = transactionQuery.data;
  const [transferPage, setTransferPage] = useState(0);
  const [logPage, setLogPage] = useState(0);

  useEffect(() => {
    setTransferPage(0);
    setLogPage(0);
  }, [transaction?.hash]);

  const chainMetadata = useMemo(
    () =>
      transaction
        ? getChainMetadataById(transaction.chainId)
        : chainId
          ? getChainMetadataById(chainId)
          : null,
    [transaction, chainId],
  );

  const explorerLink = useMemo(() => {
    if (!transaction) {
      return null;
    }
    return buildExplorerLink(transaction.chainId, transaction.hash);
  }, [transaction]);

  if (!hash || chainId === null) {
    return <div className="text-slate-300">Invalid transaction path.</div>;
  }

  if (transactionQuery.isLoading) {
    return <Skeleton className="h-64" />;
  }

  if (transactionQuery.error || !transaction) {
    return (
      <div className="rounded-xl border border-slate-800 bg-surface-light/40 p-8 text-center text-slate-400">
        Transaction not found.
      </div>
    );
  }

  const transferTotal = transaction.tokenTransfers.length;
  const transferPages = Math.max(1, Math.ceil(transferTotal / TRANSFER_PAGE_SIZE));
  const showTransferPager = transferTotal > TRANSFER_PAGE_SIZE;
  const transferStart = transferPage * TRANSFER_PAGE_SIZE;
  const paginatedTransfers = transaction.tokenTransfers.slice(
    transferStart,
    transferStart + TRANSFER_PAGE_SIZE,
  );

  const logTotal = transaction.logs.length;
  const logPages = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE));
  const showLogPager = logTotal > LOG_PAGE_SIZE;
  const logStart = logPage * LOG_PAGE_SIZE;
  const paginatedLogs = transaction.logs.slice(logStart, logStart + LOG_PAGE_SIZE);

  const statusBadge =
    transaction.status === null ? (
      <Badge variant="warning">Pending</Badge>
    ) : transaction.status ? (
      <Badge variant="success">Success</Badge>
    ) : (
      <Badge variant="warning">Failed</Badge>
    );

  const method = transaction.methodSignature
    ? {
        label: transaction.methodSignature,
        selector: transaction.methodSelector,
      }
    : decodeMethod(transaction.input);
  const feeWei =
    transaction.gasUsed && transaction.effectiveGasPrice
      ? (BigInt(transaction.gasUsed) * BigInt(transaction.effectiveGasPrice)).toString()
      : null;

  const valueFormatted = formatWeiToEther(transaction.value);
  const feeFormatted = formatWeiToEther(feeWei);
  const gasPriceFormatted = formatWeiToGwei(transaction.effectiveGasPrice);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
              <span>Transaction</span>
              {chainMetadata ? (
                <Badge>
                  {chainMetadata.shortName} • Chain {transaction.chainId}
                </Badge>
              ) : null}
              {statusBadge}
            </div>
            <h1 className="text-2xl font-semibold text-slate-100">
              {truncateAddress(transaction.hash, 10)}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <Copyable value={transaction.hash} display={`${transaction.hash.slice(0, 14)}…`} />
              <span>{formatTimestamp(transaction.timestamp)}</span>
              {explorerLink ? (
                <a
                  href={explorerLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-300 hover:text-primary-100"
                >
                  View on explorer
                </a>
              ) : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Value" value={valueFormatted} />
            <StatCard label="Gas Used" value={formatNumber(transaction.gasUsed ?? "-")} />
            <StatCard label="Fee" value={feeFormatted ?? "—"} hint={gasPriceFormatted} />
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">From</p>
            <Link
              to={`/address/${encodeURIComponent(transaction.from)}?chainId=${transaction.chainId}`}
              className="text-sm text-primary-200 hover:text-primary-100"
            >
              {transaction.from}
            </Link>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">To</p>
            {transaction.to ? (
              <Link
                to={`/address/${encodeURIComponent(transaction.to)}?chainId=${transaction.chainId}`}
                className="text-sm text-primary-200 hover:text-primary-100"
              >
                {transaction.to}
              </Link>
            ) : (
              <span className="text-sm text-slate-300">Contract creation</span>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">Method</p>
            <div className="text-sm text-slate-200">
              {method.label}{" "}
              {method.selector ? (
                <span className="text-xs text-slate-500">({method.selector})</span>
              ) : null}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-slate-500">Contract</p>
            {transaction.contractAddress ? (
              <Copyable
                value={transaction.contractAddress}
                display={truncateAddress(transaction.contractAddress)}
              />
            ) : (
              <span className="text-sm text-slate-300">—</span>
            )}
          </div>
        </div>
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Execution details
          </h2>
          <dl className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-slate-500">Block</dt>
              <dd className="text-sm text-slate-200">{transaction.blockNumber}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Block hash</dt>
              <dd className="text-sm text-slate-200">
                {transaction.blockHash ? (
                  <Copyable
                    value={transaction.blockHash}
                    display={truncateAddress(transaction.blockHash)}
                  />
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Nonce</dt>
              <dd className="text-sm text-slate-200">{transaction.nonce ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Gas limit</dt>
              <dd className="text-sm text-slate-200">{formatNumber(transaction.gas ?? "-")}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs uppercase text-slate-500">Input data</dt>
              <dd className="mt-1 break-all rounded-lg border border-slate-800/70 bg-slate-900/40 p-3 text-xs text-slate-300">
                {transaction.input && transaction.input !== "0x" ? transaction.input : "0x"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <h2 className="text-lg font-semibold text-slate-100">Token transfers</h2>
        <div className="mt-4">
          <Table<TokenTransferEntry>
            columns={[
              {
                key: "logIndex",
                header: "Log",
                render: (row) => `#${row.logIndex}`,
                className: "w-20",
              },
              {
                key: "token",
                header: "Token",
                render: (row) => (
                  <Copyable value={row.token} display={truncateAddress(row.token)} />
                ),
              },
              {
                key: "from",
                header: "From",
                render: (row) => (
                  <Link
                    to={`/address/${encodeURIComponent(row.from)}?chainId=${transaction.chainId}`}
                    className="text-primary-200 hover:text-primary-100"
                  >
                    {truncateAddress(row.from)}
                  </Link>
                ),
              },
              {
                key: "to",
                header: "To",
                render: (row) => (
                  <Link
                    to={`/address/${encodeURIComponent(row.to)}?chainId=${transaction.chainId}`}
                    className="text-primary-200 hover:text-primary-100"
                  >
                    {truncateAddress(row.to)}
                  </Link>
                ),
              },
              {
                key: "value",
                header: "Value",
                render: (row) => formatNumber(row.value),
                className: "text-right",
              },
            ]}
            data={paginatedTransfers}
            emptyState="No token transfers in this transaction."
            getRowKey={(row) => `${row.logIndex}-${row.token}`}
          />
        </div>
        {showTransferPager ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <button
              type="button"
              onClick={() => setTransferPage((page) => Math.max(0, page - 1))}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-300 transition hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={transferPage === 0}
            >
              Prev
            </button>
            <span>
              Page {transferPage + 1} of {transferPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setTransferPage((page) =>
                  page + 1 >= transferPages ? page : Math.min(transferPages - 1, page + 1),
                )
              }
              className="rounded-full border border-primary-500/50 px-3 py-1 text-primary-200 transition hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:text-slate-500"
              disabled={transferPage + 1 >= transferPages}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <h2 className="text-lg font-semibold text-slate-100">Logs</h2>
        <div className="mt-4">
          <Table<TransactionLog>
            columns={[
              {
                key: "index",
                header: "Log",
                render: (row) => `#${row.index}`,
                className: "w-20",
              },
              {
                key: "address",
                header: "Address",
                render: (row) => (
                  <Copyable value={row.address} display={truncateAddress(row.address)} />
                ),
              },
              {
                key: "topics",
                header: "Topics",
                render: (row) => (
                  <ul className="space-y-1">
                    {row.topics.map((topic, idx) => (
                      <li key={idx} className="break-all text-xs text-slate-300">
                        {topic ?? "null"}
                      </li>
                    ))}
                  </ul>
                ),
              },
              {
                key: "data",
                header: "Data",
                render: (row) => (
                  <span className="break-all text-xs text-slate-300">{row.data ?? "—"}</span>
                ),
              },
            ]}
            data={paginatedLogs}
            emptyState="No logs emitted."
            getRowKey={(row) => `${row.index}-${row.address}`}
          />
        </div>
        {showLogPager ? (
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <button
              type="button"
              onClick={() => setLogPage((page) => Math.max(0, page - 1))}
              className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-300 transition hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={logPage === 0}
            >
              Prev
            </button>
            <span>
              Page {logPage + 1} of {logPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setLogPage((page) =>
                  page + 1 >= logPages ? page : Math.min(logPages - 1, page + 1),
                )
              }
              className="rounded-full border border-primary-500/50 px-3 py-1 text-primary-200 transition hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:cursor-not-allowed disabled:border-slate-700/60 disabled:text-slate-500"
              disabled={logPage + 1 >= logPages}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
