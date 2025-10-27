import { Chain } from "../types/chains";

export const SUPPORTED_CHAIN_IDS = [1, 10, 56, 137, 42161, 43114, 8453, 324, 5000] as const;

const chainMap: Record<number, Chain> = {
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
    name: "BSC",
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
    name: "zkSync",
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
    name: "Arbitrum One",
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

export const CHAINS: Chain[] = [
  chainMap[1],
  chainMap[10],
  chainMap[56],
  chainMap[137],
  chainMap[42161],
  chainMap[43114],
  chainMap[8453],
  chainMap[324],
  chainMap[5000],
  chainMap[25],
];

export function getChainById(chainId: number): Chain | undefined {
  return chainMap[chainId];
}
