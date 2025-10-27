import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useHealth } from "../hooks/useHealth";
import { ChainPills } from "../components/ChainPills";
import { Skeleton } from "../components/Skeleton";
import { Table } from "../components/Table";
import { formatNumber } from "../lib/format";
import type { Chain } from "../types/api";

type PlaceholderToken = {
  name: string;
  symbol: string;
  chain: string;
  holders: number;
};

const TOP_TOKENS_PLACEHOLDER: PlaceholderToken[] = [
  { name: "Sample Token", symbol: "SAMP", chain: "Polygon", holders: 12345 },
  { name: "Explorer Utility", symbol: "XPLR", chain: "Ethereum", holders: 9898 },
  { name: "Base Pioneer", symbol: "BASEP", chain: "Base", holders: 5432 },
];

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }

  const units: Array<[label: string, value: number]> = [
    ["d", 60 * 60 * 24],
    ["h", 60 * 60],
    ["m", 60],
    ["s", 1],
  ];

  const parts: string[] = [];
  let remaining = Math.floor(seconds);

  for (const [label, value] of units) {
    if (remaining >= value) {
      const amount = Math.floor(remaining / value);
      parts.push(`${amount}${label}`);
      remaining -= amount * value;
    }

    if (parts.length === 2) {
      break;
    }
  }

  if (parts.length === 0) {
    return `${remaining}s`;
  }

  return parts.join(" ");
}

interface DashboardPageProps {
  chains?: Chain[];
  chainsLoading: boolean;
  selectedChains: number[];
  onToggleChain: (chainId: number) => void;
  onQuickSearch: (value: string) => void;
}

export function DashboardPage({
  chains,
  chainsLoading,
  selectedChains,
  onToggleChain,
  onQuickSearch,
}: DashboardPageProps) {
  const { data: health, isLoading: healthLoading } = useHealth();
  const [searchValue, setSearchValue] = useState("");

  const supportedCount = useMemo(
    () => chains?.filter((chain: Chain) => chain.supported).length ?? 0,
    [chains],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchValue.trim()) {
      return;
    }

    onQuickSearch(searchValue.trim());
    setSearchValue("");
  }

  const renderStatusValue = (value: string) =>
    value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const databaseStatus = health?.services?.database ?? (health ? "unknown" : "loading");
  const redisStatus = health?.services?.redis ?? (health ? "memory_fallback" : "loading");
  const uptimeDisplay = useMemo(() => (health ? formatUptime(health.uptime) : "—"), [health]);
  const statusLabel = health?.ok ? "Operational" : "Needs Attention";
  const statusDotClass = clsx(
    "h-2.5 w-2.5 rounded-full transition-shadow",
    health?.ok
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.45)]"
      : "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]",
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-slate-100">Explorer dashboard</h1>
            <p className="text-sm text-slate-400">
              {supportedCount} supported networks are live. Cronos (25) stays visible with an
              Unsupported badge so the team can surface it without enabling traffic yet.
            </p>
          </div>
          <div className="mt-5">
            {chainsLoading || !chains ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <ChainPills chains={chains} selected={selectedChains} onToggle={onToggleChain} />
            )}
          </div>
          <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
            <input
              type="text"
              value={searchValue}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setSearchValue(event.target.value)
              }
              placeholder="Search address or token (0x... or 137:0x...)"
              className="flex-1 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/40"
            />
            <button
              type="submit"
              className="rounded-lg bg-primary-500/80 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-primary-500"
            >
              Search
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
          {healthLoading || !health ? (
            <Skeleton className="h-44" />
          ) : (
            <div className="flex h-full flex-col justify-between">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-300">Backend health</p>
                <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                  <span className={statusDotClass} aria-hidden />
                  {statusLabel}
                </span>
              </div>
              <div className="mt-6 rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
                <dl className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-400">Version</dt>
                    <dd className="font-mono text-slate-100">{health.version}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-400">Uptime</dt>
                    <dd className="text-slate-100">{uptimeDisplay}</dd>
                  </div>
                </dl>
                <dl className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                    <dt>Database</dt>
                    <dd className="text-slate-200">{renderStatusValue(databaseStatus)}</dd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
                    <dt>Redis</dt>
                    <dd className="text-slate-200">{renderStatusValue(redisStatus)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-100">Top tokens</h2>
          <button
            type="button"
            onClick={() => onQuickSearch("0x0000000000000000000000000000000000001010")}
            className="text-sm text-primary-300 hover:text-primary-100"
          >
            Try sample search
          </button>
        </div>
        <div className="mt-4">
          <Table<PlaceholderToken>
            columns={[
              {
                key: "name",
                header: "Token",
                render: (row: PlaceholderToken) => (
                  <span className="font-medium text-slate-100">{row.name}</span>
                ),
              },
              { key: "symbol", header: "Symbol", render: (row: PlaceholderToken) => row.symbol },
              { key: "chain", header: "Chain", render: (row: PlaceholderToken) => row.chain },
              {
                key: "holders",
                header: "Holders",
                render: (row: PlaceholderToken) => formatNumber(row.holders),
                className: "text-right",
              },
            ]}
            data={TOP_TOKENS_PLACEHOLDER}
            emptyState="No token data yet. Connect indexers to populate."
          />
        </div>
      </section>
    </div>
  );
}
