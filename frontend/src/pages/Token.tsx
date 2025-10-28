import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useToken } from "../hooks/useToken";
import { useTokenHolders } from "../hooks/useTokenHolders";
import { useTokenChainCoverage } from "../hooks/useTokenChainCoverage";
import { Badge } from "../components/Badge";
import { Copyable } from "../components/Copyable";
import { Alert } from "../components/Alert";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { Table } from "../components/Table";
import { Tabs } from "../components/Tabs";
import { formatCompact, formatNumber, formatUsd } from "../lib/format";
import { getChainMetadataById } from "../lib/chainMetadata";
import { ApiError } from "../lib/api";
import type { TokenHolder } from "../types/api";

const TAB_OPTIONS = [
  { key: "overview", label: "Overview" },
  { key: "holders", label: "Holders" },
];

const HOLDERS_PAGE_SIZE = 25;

const COVERAGE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCoverageTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  try {
    return COVERAGE_DATE_FORMATTER.format(new Date(value));
  } catch (error) {
    console.warn("Invalid coverage timestamp", error);
    return value;
  }
}

function buildTokenExplorerLink(chainId: number, address: string): string | null {
  const chain = getChainMetadataById(chainId);
  if (!chain?.explorerUrl) {
    return null;
  }

  return `${chain.explorerUrl.replace(/\/$/, "")}/token/${address}`;
}

export function TokenPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const chainParam = searchParams.get("chainId");
  const parsedChainId = chainParam ? Number(chainParam) : NaN;
  const chainId = Number.isFinite(parsedChainId) ? parsedChainId : null;
  const address = params.address ? decodeURIComponent(params.address).toLowerCase() : null;
  const tabParam = searchParams.get("tab");
  const initialTab = TAB_OPTIONS.some((option) => option.key === tabParam) ? tabParam! : "overview";
  const [tab, setTabState] = useState<string>(initialTab);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);

  const tokenQuery = useToken(chainId, address);
  const holdersQuery = useTokenHolders(chainId, address, { cursor, limit: HOLDERS_PAGE_SIZE });
  const coverageQuery = useTokenChainCoverage(address);

  const token = tokenQuery.data;
  const coverageEntries = useMemo(() => coverageQuery.data ?? [], [coverageQuery.data]);

  useEffect(() => {
    const nextTabParam = searchParams.get("tab");
    const normalized = TAB_OPTIONS.some((option) => option.key === nextTabParam)
      ? (nextTabParam as string)
      : "overview";
    setTabState((prev) => (prev === normalized ? prev : normalized));
  }, [searchParams]);

  const handleTabChange = useCallback(
    (next: string) => {
      setTabState(next);
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        if (chainId !== null) {
          params.set("chainId", String(chainId));
        } else {
          params.delete("chainId");
        }
        return params;
      });
    },
    [chainId, setSearchParams],
  );

  const coverageBadges = useMemo(() => {
    if (!address) {
      return [];
    }

    return coverageEntries.map((entry) => {
      const metadata = getChainMetadataById(entry.chainId);
      return {
        chainId: entry.chainId,
        label: metadata?.shortName ?? `Chain ${entry.chainId}`,
        status: entry.status,
        supported: entry.supported,
        internalPath: `/token/${encodeURIComponent(address)}?chainId=${entry.chainId}&tab=holders`,
        explorerHref: buildTokenExplorerLink(entry.chainId, address),
      };
    });
  }, [address, coverageEntries]);

  const breadcrumb = useMemo(() => {
    if (!token) {
      return "";
    }

    return `${token.name} (${token.symbol})`;
  }, [token]);

  if (chainId === null || !address) {
    return <div className="text-slate-300">Invalid token path.</div>;
  }

  if (tokenQuery.isLoading) {
    return <Skeleton className="h-48" />;
  }

  if (tokenQuery.error || !token) {
    return (
      <div className="rounded-xl border border-slate-800 bg-surface-light/40 p-8 text-center text-slate-400">
        Token not found.
      </div>
    );
  }

  const holders = holdersQuery.data;
  const holdersStatus = holders?.status;
  const isIndexing = holdersStatus === "indexing";
  const hasStatus = typeof holdersStatus === "string";
  const holdersItems = holders?.items ?? [];
  const isInitialLoading = holdersQuery.isLoading && !holders;
  const isRefreshing = holdersQuery.isValidating && Boolean(holders);
  const holdersError = holdersQuery.error as ApiError | undefined;
  const holdersAlert = holdersError
    ? holdersError.status === 429
      ? {
          variant: "warning" as const,
          title: "Rate limited",
          message: "Too many requests. Try again in a moment.",
        }
      : {
          variant: "error" as const,
          title: "Unable to load holders",
          message: "Something went wrong while fetching holders. Please retry shortly.",
        }
    : null;
  const indexingMessage = "Indexing holders… this can take a few minutes.";
  const indexingAlert =
    !holdersAlert && isIndexing
      ? {
          variant: "info" as const,
          title: "Indexing holders",
          message: indexingMessage,
        }
      : null;

  const nextCursor = holders?.nextCursor ?? null;
  const hasNext = Boolean(nextCursor);
  const hasPrev = cursorHistory.length > 0;
  const holdersEmptyState = holdersAlert
    ? undefined
    : isIndexing
      ? indexingMessage
      : !hasStatus && holdersItems.length === 0
        ? "No holder data yet."
        : "No holders found for this token yet.";

  function goToNext() {
    if (!nextCursor) {
      return;
    }

    setCursorHistory((prev: Array<string | null>) => [...prev, cursor]);
    setCursor(nextCursor);
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
            {coverageBadges.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {coverageBadges.map((badge) => (
                  <div
                    key={badge.chainId}
                    className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1 text-xs text-slate-300"
                  >
                    <Link
                      to={badge.internalPath}
                      onClick={() => handleTabChange("holders")}
                      className="inline-flex items-center gap-1 text-primary-300 hover:text-primary-100"
                    >
                      {badge.label}
                      <span className="text-[0.65rem]">↗</span>
                    </Link>
                    {badge.explorerHref ? (
                      <a
                        href={badge.explorerHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-primary-200"
                      >
                        View
                        <span className="text-[0.65rem]">↗</span>
                      </a>
                    ) : null}
                    {badge.status === "ok" ? (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[0.65rem] text-emerald-300">
                        Indexed
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] text-amber-300">
                        Indexing
                      </span>
                    )}
                    {!badge.supported ? (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] text-amber-300">
                        Unsupported
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Price" value={formatUsd(token.priceUsd)} />
            <StatCard label="Holders" value={formatNumber(token.holdersCount)} />
            <StatCard label="Total Supply" value={formatCompact(Number(token.totalSupply))} />
          </div>
        </div>
        <div className="mt-6">
          <Tabs
            value={tab}
            options={TAB_OPTIONS}
            onChange={handleTabChange}
            ariaLabel="Token sections"
          />
        </div>
        <div className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Chain coverage
          </h2>
          {coverageQuery.error ? (
            <p className="mt-3 text-sm text-amber-400">Unable to load chain coverage.</p>
          ) : coverageQuery.isLoading ? (
            <Skeleton className="mt-4 h-24" />
          ) : coverageEntries.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {coverageEntries.map((entry) => {
                const metadata = getChainMetadataById(entry.chainId);
                const internalPath = `/token/${encodeURIComponent(address)}?chainId=${entry.chainId}&tab=holders`;
                const explorerHref = buildTokenExplorerLink(entry.chainId, address);
                return (
                  <div
                    key={entry.chainId}
                    className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {metadata?.shortName ?? `Chain ${entry.chainId}`}
                        </p>
                        <p className="text-xs text-slate-500">Chain {entry.chainId}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={entry.status === "ok" ? "success" : "warning"}>
                          {entry.status === "ok" ? "Indexed" : "Indexing"}
                        </Badge>
                        {!entry.supported ? <Badge variant="warning">Unsupported</Badge> : null}
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                      <div>
                        <dt>Transfers</dt>
                        <dd className="text-sm text-slate-200">
                          {formatNumber(entry.transferCount)}
                        </dd>
                      </div>
                      <div>
                        <dt>Indexed range</dt>
                        <dd className="text-sm text-slate-200">
                          {entry.fromBlock && entry.toBlock
                            ? `${entry.fromBlock} → ${entry.toBlock}`
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Last transfer block</dt>
                        <dd className="text-sm text-slate-200">{entry.lastTransferBlock ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Last transfer at</dt>
                        <dd className="text-sm text-slate-200">
                          {formatCoverageTimestamp(entry.lastTransferAt)}
                        </dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd className="text-sm text-slate-200">
                          {formatCoverageTimestamp(entry.updatedAt)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                      <Link
                        to={internalPath}
                        onClick={() => handleTabChange("holders")}
                        className="text-primary-300 hover:text-primary-100"
                      >
                        Open internal tab
                      </Link>
                      {explorerHref ? (
                        <a
                          href={explorerHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary-300 hover:text-primary-100"
                        >
                          View on explorer
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">No chain coverage recorded yet.</p>
          )}
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
              <dd className="text-sm text-slate-300">
                {token.supported ? "Supported" : "Unsupported"}
              </dd>
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
            {holdersAlert ? (
              <Alert variant={holdersAlert.variant} title={holdersAlert.title} className="mb-3">
                {holdersAlert.message}
              </Alert>
            ) : null}
            {indexingAlert ? (
              <Alert variant={indexingAlert.variant} title={indexingAlert.title} className="mb-3">
                {indexingAlert.message}
              </Alert>
            ) : null}
            <Table<TokenHolder>
              columns={[
                {
                  key: "rank",
                  header: "#",
                  render: (row: TokenHolder) => row.rank,
                  className: "w-14",
                },
                {
                  key: "holder",
                  header: "Address",
                  render: (row: TokenHolder) => (
                    <Copyable value={row.holder} display={`${row.holder.slice(0, 10)}…`} />
                  ),
                },
                {
                  key: "balance",
                  header: "Balance",
                  render: (row: TokenHolder) => formatNumber(row.balance),
                },
                {
                  key: "pct",
                  header: "%",
                  render: (row: TokenHolder) => `${row.pct.toFixed(2)}%`,
                  className: "text-right",
                },
              ]}
              data={holdersItems}
              emptyState={holdersEmptyState}
              isLoading={isInitialLoading}
              loadingState={
                <span className="inline-flex items-center justify-center gap-2 text-slate-300">
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"
                  />
                  Loading holders…
                </span>
              }
              getRowKey={(row: TokenHolder) => `${row.holder}-${row.rank}`}
            />
          </div>
          {isRefreshing ? (
            <p className="mt-2 text-xs text-slate-500">
              {isIndexing ? indexingMessage : "Refreshing holders…"}
            </p>
          ) : null}
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
                disabled={isInitialLoading || !hasPrev}
                onClick={goToPrevious}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded-full border border-primary-500/50 px-3 py-1 text-primary-200 transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400 disabled:border-slate-700/60 disabled:text-slate-500"
                disabled={isInitialLoading || !hasNext}
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
