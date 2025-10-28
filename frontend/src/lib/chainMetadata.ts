import type { Chain } from "../types/api";

export type ChainMetadata = Chain;

const ORDERED_CHAIN_METADATA: ChainMetadata[] = [
  {
    id: 1,
    key: "ethereum",
    name: "Ethereum",
    shortName: "Ethereum",
    nativeSymbol: "ETH",
    explorerUrl: "https://etherscan.io",
    supported: true,
  },
  {
    id: 10,
    key: "optimism",
    name: "Optimism",
    shortName: "Optimism",
    nativeSymbol: "OP",
    explorerUrl: "https://optimistic.etherscan.io",
    supported: true,
  },
  {
    id: 56,
    key: "bsc",
    name: "BNB Chain",
    shortName: "BSC",
    nativeSymbol: "BNB",
    explorerUrl: "https://bscscan.com",
    supported: true,
  },
  {
    id: 137,
    key: "polygon",
    name: "Polygon",
    shortName: "Polygon",
    nativeSymbol: "MATIC",
    explorerUrl: "https://polygonscan.com",
    supported: true,
  },
  {
    id: 42161,
    key: "arbitrum",
    name: "Arbitrum One",
    shortName: "Arbitrum",
    nativeSymbol: "ETH",
    explorerUrl: "https://arbiscan.io",
    supported: true,
  },
  {
    id: 43114,
    key: "avalanche",
    name: "Avalanche C-Chain",
    shortName: "Avalanche",
    nativeSymbol: "AVAX",
    explorerUrl: "https://snowtrace.io",
    supported: true,
  },
  {
    id: 8453,
    key: "base",
    name: "Base",
    shortName: "Base",
    nativeSymbol: "ETH",
    explorerUrl: "https://basescan.org",
    supported: true,
  },
  {
    id: 324,
    key: "zksync",
    name: "zkSync Era",
    shortName: "zkSync",
    nativeSymbol: "ETH",
    explorerUrl: "https://explorer.zksync.io",
    supported: true,
  },
  {
    id: 5000,
    key: "mantle",
    name: "Mantle",
    shortName: "Mantle",
    nativeSymbol: "MNT",
    explorerUrl: "https://mantlescan.xyz",
    supported: true,
  },
  {
    id: 25,
    key: "cronos",
    name: "Cronos",
    shortName: "Cronos",
    nativeSymbol: "CRO",
    explorerUrl: "https://cronoscan.com",
    supported: false,
  },
];

const CHAIN_METADATA_BY_ID = ORDERED_CHAIN_METADATA.reduce<Record<number, ChainMetadata>>(
  (accumulator, chain) => {
    accumulator[chain.id] = chain;
    return accumulator;
  },
  {},
);

type RawChain = Partial<Chain> & { id: number; supported?: boolean };

export function mergeChainMetadata(chains: RawChain[]): Chain[] {
  const mapped = new Map<number, Chain>();

  for (const chain of chains) {
    const metadata = CHAIN_METADATA_BY_ID[chain.id];
    const base = metadata ?? {
      id: chain.id,
      key: `chain-${chain.id}`,
      name: chain.name ?? `Chain ${chain.id}`,
      shortName: chain.shortName ?? chain.name ?? `Chain ${chain.id}`,
      nativeSymbol: chain.nativeSymbol ?? "",
      explorerUrl: chain.explorerUrl ?? "",
      supported: chain.supported ?? false,
    };

    mapped.set(chain.id, {
      ...base,
      key: chain.key ?? base.key,
      name: chain.name ?? base.name,
      shortName: chain.shortName ?? base.shortName,
      nativeSymbol: chain.nativeSymbol ?? base.nativeSymbol,
      explorerUrl: chain.explorerUrl ?? base.explorerUrl,
      supported: chain.supported ?? base.supported,
    });
  }

  const ordered: Chain[] = [];

  for (const chain of ORDERED_CHAIN_METADATA) {
    const existing = mapped.get(chain.id);
    if (existing) {
      ordered.push(existing);
      mapped.delete(chain.id);
    } else {
      ordered.push({ ...chain });
    }
  }

  for (const chain of mapped.values()) {
    ordered.push({ ...chain });
  }

  return ordered;
}

export function getOrderedChainMetadata(): ChainMetadata[] {
  return [...ORDERED_CHAIN_METADATA];
}

export function getChainMetadataById(chainId: number): ChainMetadata | undefined {
  const metadata = CHAIN_METADATA_BY_ID[chainId];
  return metadata ? { ...metadata } : undefined;
}
