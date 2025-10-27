import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useHealth } from "../hooks/useHealth";
import { ChainPills } from "../components/ChainPills";
import { Skeleton } from "../components/Skeleton";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/Badge";
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

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Multi-chain overview</h1>
            <p className="mt-1 text-sm text-slate-400">
              {supportedCount} supported chains live. Cronos visible but currently unsupported.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">Live</Badge>
          </div>
        </div>
        <div className="mt-6">
          {chainsLoading || !chains ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <ChainPills chains={chains} selected={selectedChains} onToggle={onToggleChain} />
          )}
        </div>
      </section>

      <section>
        <div className="grid gap-4 md:grid-cols-3">
          {healthLoading || !health ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <StatCard label="Service Status" value={health.ok ? "Operational" : "Degraded"} hint={`Version ${health.version}`} />
              <StatCard label="Uptime" value={`${formatNumber(health.uptime)}s`} hint="Smoothed over process lifetime" />
              <StatCard label="Selected Chains" value={selectedChains.length} hint="Adjust filters above" />
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/70 bg-surface-light/40 p-6 shadow-subtle">
        <h2 className="text-xl font-semibold text-slate-100">Quick search</h2>
        <p className="mt-1 text-sm text-slate-400">
          Paste an address or use <code className="rounded bg-slate-900/60 px-1">chainId:address</code> to jump directly.
        </p>
        <form className="mt-4 flex flex-col gap-3 md:flex-row" onSubmit={handleSubmit}>
          <input
            type="text"
            value={searchValue}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchValue(event.target.value)}
            placeholder="0x... or 137:0x..."
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-primary-500/80 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-primary-500"
          >
            Search
          </button>
        </form>
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
