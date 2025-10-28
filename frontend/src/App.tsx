import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { SWRConfig } from "swr";
import { TopNav } from "./components/TopNav";
import { ChainPills } from "./components/ChainPills";
import { Header } from "./components/layout/Header";
import { DashboardPage } from "./pages/Dashboard";
import { TokensPage } from "./pages/Tokens";
import { TokenPage } from "./pages/Token";
import { TransactionPage } from "./pages/Transaction";
import { AddressPage } from "./pages/Address";
import { AdminLayout } from "./pages/AdminLayout";
import { AdminSettingsPage } from "./pages/AdminSettings";
import { AdminConnectionsPage } from "./pages/AdminConnections";
import { LoginPage } from "./pages/Login";
import { useChains } from "./hooks/useChains";
import type { Chain } from "./types/api";

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: chains, isLoading: chainsLoading } = useChains();
  const [selectedChains, setSelectedChains] = useState<number[]>([]);

  useEffect(() => {
    if (chains && chains.length && selectedChains.length === 0) {
      const supported = chains
        .filter((chain: Chain) => chain.supported)
        .map((chain: Chain) => chain.id);
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
      let remaining = trimmed;

      const chainMatch = remaining.match(/^(\d+):(.*)$/);
      if (chainMatch) {
        const parsed = Number(chainMatch[1]);
        if (Number.isFinite(parsed)) {
          chainId = parsed;
          remaining = chainMatch[2];
        }
      }

      remaining = remaining.trim();

      if (!remaining) {
        return;
      }

      let requestedType: "token" | "address" | "transaction" | null = null;
      const typeMatch = remaining.match(/^(tx|transaction|addr|address|token):/i);
      if (typeMatch) {
        const prefix = typeMatch[1].toLowerCase();
        if (prefix.startsWith("tx")) {
          requestedType = "transaction";
        } else if (prefix.startsWith("addr")) {
          requestedType = "address";
        } else if (prefix.startsWith("token")) {
          requestedType = "token";
        }
        remaining = remaining.slice(typeMatch[0].length).trim();
      }

      if (!remaining) {
        return;
      }

      const normalized = remaining.toLowerCase();

      if (!requestedType) {
        if (normalized.startsWith("0x") && normalized.length === 66) {
          requestedType = "transaction";
        } else if (normalized.startsWith("0x") && normalized.length === 42) {
          requestedType = "token";
        } else {
          requestedType = "token";
        }
      }

      const encoded = encodeURIComponent(normalized);

      if (requestedType === "transaction") {
        navigate(`/tx/${encoded}?chainId=${chainId}`);
        return;
      }

      if (requestedType === "address") {
        navigate(`/address/${encoded}?chainId=${chainId}`);
        return;
      }

      navigate(`/token/${encoded}?chainId=${chainId}`);
    },
    [defaultChainId, navigate],
  );

  const chainActions = chains ? (
    <ChainPills chains={chains} selected={selectedChains} onToggle={handleToggleChain} />
  ) : null;

  return (
    <div className="min-h-screen bg-surface text-slate-100">
      <Header />
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
          <Route
            path="/token/:address"
            element={<TokenPage key={`${location.pathname}${location.search}`} />}
          />
          <Route path="/token" element={<TokensPage />} />
          <Route path="/tx/:hash" element={<TransactionPage />} />
          <Route path="/address/:address" element={<AddressPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/*" element={<AdminLayout />}>
            <Route index element={<Navigate to="settings" replace />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="connections" element={<AdminConnectionsPage />} />
          </Route>
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
