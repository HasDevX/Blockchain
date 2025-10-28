import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "../components/Badge";
import { Copyable } from "../components/Copyable";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { Table } from "../components/Table";
import { useAddressActivity } from "../hooks/useAddressActivity";
import { formatNumber, truncateAddress } from "../lib/format";
import { getChainMetadataById } from "../lib/chainMetadata";
import type { AddressActivityItem } from "../types/api";

const PAGE_SIZE = 25;

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

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

function buildExplorerLink(chainId: number, address: string): string | null {
  const chain = getChainMetadataById(chainId);
  if (!chain?.explorerUrl) {
    return null;
  }

  return `${chain.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

function aggregateActivity(items: AddressActivityItem[]) {
  let incomingCount = 0;
  let outgoingCount = 0;
  let incomingValue = 0n;
  let outgoingValue = 0n;

  for (const item of items) {
    if (item.direction === "in") {
      incomingCount += 1;
      try {
        incomingValue += BigInt(item.value);
      } catch (error) {
        console.warn("Unable to parse incoming value", error);
      }
    } else {
      outgoingCount += 1;
      try {
        outgoingValue += BigInt(item.value);
      } catch (error) {
        console.warn("Unable to parse outgoing value", error);
      }
    }
  }

  return {
    incomingCount,
    outgoingCount,
    incomingValue,
    outgoingValue,
  };
}

function formatBigIntSummary(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  if (absolute <= maxSafe) {
    return formatNumber(Number(value));
  }

  const asString = value.toString();
  if (asString.length <= 6) {
    return asString;
  }

  return `${asString.slice(0, 3)}…${asString.slice(-3)}`;
}

export function AddressPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const chainParam = searchParams.get("chainId");
  const parsedChainId = chainParam ? Number(chainParam) : NaN;
  const chainId = Number.isFinite(parsedChainId) ? parsedChainId : null;
  const address = params.address ? decodeURIComponent(params.address).toLowerCase() : null;

  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);

  const activityQuery = useAddressActivity(chainId, address, { cursor, limit: PAGE_SIZE });
  const activity = activityQuery.data;
  const tokenTransfers = useMemo(() => {
    const transfers = activity?.tokenTransfers ?? activity?.items ?? [];
    return Array.isArray(transfers) ? transfers : [];
  }, [activity?.items, activity?.tokenTransfers]);
  const seenTokens = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of tokenTransfers) {
      counts.set(item.token, (counts.get(item.token) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token);
  }, [tokenTransfers]);

  const chainMetadata = useMemo(() => (chainId ? getChainMetadataById(chainId) : null), [chainId]);
  const explorerLink = useMemo(() => {
    if (!address || chainId === null) {
      return null;
    }
    return buildExplorerLink(chainId, address);
  }, [address, chainId]);

  if (!address || chainId === null) {
    return <div className="text-slate-300">Invalid address path.</div>;
  }

  if (activityQuery.isLoading && !activity) {
    return <Skeleton className="h-48" />;
  }

  if (activityQuery.error || !activity) {
    return (
      <div className="rounded-xl border border-slate-800 bg-surface-light/40 p-8 text-center text-slate-400">
        Address activity unavailable.
      </div>
    );
  }

  const stats = aggregateActivity(tokenTransfers);
  const hasPrev = cursorHistory.length > 0;
  const nextCursor = activity.nextCursor ?? null;
  const hasNext = Boolean(nextCursor);
  const isRefreshing = activityQuery.isValidating && Boolean(tokenTransfers.length);

  function loadNext() {
    if (!nextCursor) {
      return;
    }

    setCursorHistory((prev) => [...prev, cursor]);
    setCursor(nextCursor);
  }

  function loadPrevious() {
    setCursorHistory((prev) => {
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
              <span>Address</span>
              {chainMetadata ? (
                <Badge>
                  {chainMetadata.shortName} • Chain {chainMetadata.id}
                </Badge>
              ) : null}
            </div>
            <h1 className="text-2xl font-semibold text-slate-100">
              {truncateAddress(address, 12)}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <Copyable value={address} display={`${address.slice(0, 14)}…`} />
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
            {seenTokens.length ? (
              <div>
                <p className="text-xs uppercase text-slate-500">Token holdings</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {seenTokens.slice(0, 8).map((token) => (
                    <Link
                      key={token}
                      to={`/token/${encodeURIComponent(token)}?chainId=${chainId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-primary-500/40 bg-primary-500/10 px-3 py-1 text-xs font-medium text-primary-200 transition hover:border-primary-400 hover:text-primary-100"
                    >
                      {truncateAddress(token, 10)}
                      <span className="text-[0.65rem] text-primary-300">↗</span>
                    </Link>
                  ))}
                  {seenTokens.length > 8 ? (
                    <span className="rounded-full border border-slate-700/60 px-3 py-1 text-xs text-slate-400">
                      +{seenTokens.length - 8} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Incoming transfers"
              value={stats.incomingCount}
              hint={`Σ ${formatBigIntSummary(stats.incomingValue)}`}
            />
            <StatCard
              label="Outgoing transfers"
              value={stats.outgoingCount}
              hint={`Σ ${formatBigIntSummary(stats.outgoingValue)}`}
            />
            <StatCard
              label="Net transfers"
              value={stats.incomingCount - stats.outgoingCount}
              hint={`Δ ${(stats.incomingValue - stats.outgoingValue).toString()}`}
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Recent activity</h2>
          <div className="text-xs text-slate-500">Page size {PAGE_SIZE}</div>
        </div>
        <div className="mt-4">
          <Table<AddressActivityItem>
            columns={[
              {
                key: "timestamp",
                header: "Timestamp",
                render: (row) => formatTimestamp(row.timestamp),
              },
              {
                key: "txHash",
                header: "Transaction",
                render: (row) => (
                  <Link
                    to={`/tx/${encodeURIComponent(row.txHash)}?chainId=${chainId}`}
                    className="text-primary-200 hover:text-primary-100"
                  >
                    {truncateAddress(row.txHash, 10)}
                  </Link>
                ),
              },
              {
                key: "direction",
                header: "Direction",
                render: (row) => (
                  <Badge variant={row.direction === "in" ? "success" : "default"}>
                    {row.direction === "in" ? "In" : "Out"}
                  </Badge>
                ),
              },
              {
                key: "token",
                header: "Token",
                render: (row) => (
                  <Copyable value={row.token} display={truncateAddress(row.token)} />
                ),
              },
              {
                key: "counterparty",
                header: "Counterparty",
                render: (row) => {
                  const counterparty = row.direction === "in" ? row.from : row.to;
                  return (
                    <Link
                      to={`/address/${encodeURIComponent(counterparty)}?chainId=${chainId}`}
                      className="text-primary-200 hover:text-primary-100"
                    >
                      {truncateAddress(counterparty, 10)}
                    </Link>
                  );
                },
              },
              {
                key: "value",
                header: "Value",
                render: (row) => formatNumber(row.value),
                className: "text-right",
              },
            ]}
            data={tokenTransfers}
            emptyState="No transfers recorded yet."
            isLoading={activityQuery.isLoading && !tokenTransfers.length}
            loadingState="Loading activity…"
            getRowKey={(row) => `${row.txHash}-${row.logIndex}`}
          />
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <button
            type="button"
            onClick={resetPagination}
            className="text-primary-300 hover:text-primary-100 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
            disabled={!cursor && !cursorHistory.length}
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-700/60 px-3 py-1 text-slate-300 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400"
              disabled={!hasPrev}
              onClick={loadPrevious}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-full border border-primary-500/50 px-3 py-1 text-primary-200 transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:border-slate-700/60 disabled:text-slate-500"
              disabled={!hasNext}
              onClick={loadNext}
            >
              Next
            </button>
          </div>
        </div>
        {isRefreshing ? <p className="mt-2 text-xs text-slate-500">Refreshing activity…</p> : null}
      </section>
    </div>
  );
}
