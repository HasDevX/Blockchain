import type { Chain } from "../types/api";

export const CHAIN_METADATA: Record<number, Chain> = {
  1: {
    id: 1,
    key: "ethereum",
    name: "Ethereum",
    shortName: "ETH",
    nativeSymbol: "ETH",
    explorerUrl: "https://etherscan.io",
    supported: true,
  },
  10: {
    id: 10,
    key: "optimism",
    name: "Optimism",
    shortName: "OP",
    nativeSymbol: "ETH",
    explorerUrl: "https://optimistic.etherscan.io",
    supported: true,
  },
  25: {
    id: 25,
    key: "cronos",
    name: "Cronos",
    shortName: "CRO",
    nativeSymbol: "CRO",
    explorerUrl: "https://cronoscan.com",
    supported: false,
  },
  56: {
    id: 56,
    key: "bsc",
    name: "BNB Smart Chain",
    shortName: "BSC",
    nativeSymbol: "BNB",
    explorerUrl: "https://bscscan.com",
    supported: true,
  },
  137: {
    id: 137,
    key: "polygon",
    name: "Polygon",
    shortName: "POL",
    nativeSymbol: "POL",
    explorerUrl: "https://polygonscan.com",
    supported: true,
  },
  324: {
    id: 324,
    key: "zkSync",
    name: "zkSync Era",
    shortName: "ZKS",
    nativeSymbol: "ETH",
    explorerUrl: "https://explorer.zksync.io",
    supported: true,
  },
  5000: {
    id: 5000,
    key: "mantle",
    name: "Mantle",
    shortName: "MNT",
    nativeSymbol: "MNT",
    explorerUrl: "https://mantlescan.xyz",
    supported: true,
  },
  8453: {
    id: 8453,
    key: "base",
    name: "Base",
    shortName: "BASE",
    nativeSymbol: "ETH",
    explorerUrl: "https://basescan.org",
    supported: true,
  },
  42161: {
    id: 42161,
    key: "arbitrum",
    name: "Arbitrum",
    shortName: "ARB",
    nativeSymbol: "ETH",
    explorerUrl: "https://arbiscan.io",
    supported: true,
  },
  43114: {
    id: 43114,
    key: "avalanche",
    name: "Avalanche C-Chain",
    shortName: "AVAX",
    nativeSymbol: "AVAX",
    explorerUrl: "https://snowtrace.io",
    supported: true,
  },
};

export function mergeChainMetadata(partial: Partial<Chain> & { id: number }): Chain {
  const known = CHAIN_METADATA[partial.id];
  const fallbackName = `Chain ${partial.id}`;

  if (!known) {
    return {
      id: partial.id,
      key: partial.key ?? `chain-${partial.id}`,
      name: partial.name ?? fallbackName,
      shortName: partial.shortName ?? fallbackName,
      nativeSymbol: partial.nativeSymbol ?? partial.shortName ?? "",
      explorerUrl: partial.explorerUrl ?? "",
      supported: Boolean(partial.supported),
    };
  }

  return {
    ...known,
    ...partial,
    name: partial.name ?? known.name,
    shortName: partial.shortName ?? known.shortName,
    nativeSymbol: partial.nativeSymbol ?? known.nativeSymbol,
    explorerUrl: partial.explorerUrl ?? known.explorerUrl,
    supported: typeof partial.supported === "boolean" ? partial.supported : known.supported,
  };
}
