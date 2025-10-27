import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useToken } from "../hooks/useToken";
import { useTokenHolders } from "../hooks/useTokenHolders";
import { Badge } from "../components/Badge";
import { Copyable } from "../components/Copyable";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { Table } from "../components/Table";
import { Tabs } from "../components/Tabs";
import { formatCompact, formatNumber, formatUsd } from "../lib/format";
import type { TokenHolder } from "../types/api";

const TAB_OPTIONS = [
  { key: "overview", label: "Overview" },
  { key: "holders", label: "Holders" },
];

const HOLDERS_PAGE_SIZE = 25;

export function TokenPage() {
  const params = useParams();
  const chainId = params.chainId ? Number(params.chainId) : null;
  const address = params.address ?? null;
  const [tab, setTab] = useState<string>("overview");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);

  const tokenQuery = useToken(chainId, address);
  const holdersQuery = useTokenHolders(chainId, address, { cursor, limit: HOLDERS_PAGE_SIZE });

  const token = tokenQuery.data;

  const breadcrumb = useMemo(() => {
    if (!token) {
      return "";
    }

    return `${token.name} (${token.symbol})`;
  }, [token]);

  if (!chainId || !address) {
    return <div className="text-slate-300">Invalid token path.</div>;
  }

  if (tokenQuery.isLoading) {
    return <Skeleton className="h-48" />;
  }

  if (tokenQuery.error || !token) {
    return <div className="rounded-xl border border-slate-800 bg-surface-light/40 p-8 text-center text-slate-400">Token not found.</div>;
  }

  const holders = holdersQuery.data;

  const hasNext = Boolean(holders?.nextCursor);
  const hasPrev = cursorHistory.length > 0;

  function goToNext() {
    if (!holders?.nextCursor) {
      return;
    }

    setCursorHistory((prev: Array<string | null>) => [...prev, cursor]);
    setCursor(holders.nextCursor);
  }

  function goToPrevious() {
    setCursorHistory((prev: Array<string | null>) => {
      if (!prev.length) {
        return prev;
      }

      const updated = [...prev];
      const previous = updated.pop() ?? null;
      setCursor(previous);
      return updated;
    });
  }

  function resetPagination() {
    setCursor(null);
    setCursorHistory([]);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Token</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-100">{breadcrumb}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-400">
              <Copyable value={token.address} display={`${token.address.slice(0, 10)}…`} />
              <span>{token.supported ? "Supported chain" : "Unsupported chain"}</span>
              {!token.supported ? <Badge variant="warning">Unsupported</Badge> : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Price" value={formatUsd(token.priceUsd)} />
            <StatCard label="Holders" value={formatNumber(token.holdersCount)} />
            <StatCard label="Total Supply" value={formatCompact(Number(token.totalSupply))} />
          </div>
        </div>
        <div className="mt-6">
          <Tabs value={tab} options={TAB_OPTIONS} onChange={setTab} />
        </div>
      </section>

      {tab === "overview" ? (
        <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
          <h2 className="text-lg font-semibold text-slate-100">Overview</h2>
          <dl className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-slate-500">Explorer</dt>
              <dd className="text-sm text-primary-300">
                <a href={token.explorerUrl} target="_blank" rel="noreferrer">
                  {token.explorerUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Chain ID</dt>
              <dd className="text-sm text-slate-300">{token.chainId}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Token Symbol</dt>
              <dd className="text-sm text-slate-300">{token.symbol}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-500">Support Status</dt>
              <dd className="text-sm text-slate-300">{token.supported ? "Supported" : "Unsupported"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {tab === "holders" ? (
        <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">Top holders</h2>
            <div className="text-xs text-slate-500">Page size {HOLDERS_PAGE_SIZE}</div>
          </div>
          <div className="mt-4">
            {holdersQuery.isLoading && !holders ? (
              <Skeleton className="h-48" />
            ) : (
              <Table<TokenHolder>
                columns={[
                  { key: "rank", header: "#", render: (row: TokenHolder) => row.rank, className: "w-12" },
                  {
                    key: "address",
                    header: "Address",
                    render: (row: TokenHolder) => (
                      <Copyable value={row.address} display={`${row.address.slice(0, 10)}…`} />
                    ),
                  },
                  {
                    key: "balance",
                    header: "Balance",
                    render: (row: TokenHolder) => formatNumber(row.balance),
                  },
                  {
                    key: "percentage",
                    header: "%",
                    render: (row: TokenHolder) => `${row.percentage.toFixed(2)}%`,
                    className: "text-right",
                  },
                ]}
                data={holders?.items ?? []}
                emptyState="No holders indexed yet."
              />
            )}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
            <button
              type="button"
              onClick={resetPagination}
              className="text-primary-300 hover:text-primary-100"
              disabled={!cursor && !cursorHistory.length}
            >
              Reset
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-300"
                disabled={!hasPrev}
                onClick={goToPrevious}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded-full border border-primary-500/50 px-3 py-1 text-primary-200 disabled:border-slate-700/60 disabled:text-slate-500"
                disabled={!hasNext}
                onClick={goToNext}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
