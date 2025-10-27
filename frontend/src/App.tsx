import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { SWRConfig } from "swr";
import { TopNav } from "./components/TopNav";
import { ChainPills } from "./components/ChainPills";
import { DashboardPage } from "./pages/Dashboard";
import { TokenPage } from "./pages/Token";
import { AdminPage } from "./pages/Admin";
import { useChains } from "./hooks/useChains";
import type { Chain } from "./types/api";

function Shell() {
  const navigate = useNavigate();
  const { data: chains, isLoading: chainsLoading } = useChains();
  const [selectedChains, setSelectedChains] = useState<number[]>([]);

  useEffect(() => {
    if (chains && chains.length && selectedChains.length === 0) {
      const supported = chains.filter((chain: Chain) => chain.supported).map((chain: Chain) => chain.id);
      setSelectedChains(supported);
    }
  }, [chains, selectedChains.length]);

  const defaultChainId = useMemo(() => {
    if (selectedChains.length) {
      return selectedChains[0];
    }

  const firstSupported = chains?.find((chain: Chain) => chain.supported)?.id;
    return firstSupported ?? 137;
  }, [chains, selectedChains]);

  const handleToggleChain = useCallback(
    (chainId: number) => {
      setSelectedChains((current: number[]) => {
        if (!chains?.find((chain: Chain) => chain.id === chainId)?.supported) {
          return current;
        }

        if (current.includes(chainId)) {
          return current.filter((id: number) => id !== chainId);
        }

        return [...current, chainId];
      });
    },
    [chains],
  );

  const handleGlobalSearch = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }

      let chainId = defaultChainId;
      let address = trimmed;

      if (trimmed.includes(":")) {
        const [prefix, rest] = trimmed.split(":");
        const parsed = Number(prefix);
        if (!Number.isNaN(parsed) && rest) {
          chainId = parsed;
          address = rest;
        }
      }

      navigate(`/token/${chainId}/${address}`);
    },
    [defaultChainId, navigate],
  );

  const chainActions = chains ? (
    <ChainPills chains={chains} selected={selectedChains} onToggle={handleToggleChain} />
  ) : null;

  return (
    <div className="min-h-screen bg-surface text-slate-100">
      <TopNav onGlobalSearch={handleGlobalSearch} actions={chainActions} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                chains={chains}
                chainsLoading={chainsLoading}
                selectedChains={selectedChains}
                onToggleChain={handleToggleChain}
                onQuickSearch={handleGlobalSearch}
              />
            }
          />
          <Route path="/token/:chainId/:address" element={<TokenPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      }}
    >
      <Shell />
    </SWRConfig>
  );
}

export default App;
