export type ChainVendor = "etherscan";

export interface ChainRateBudget {
  /** Requests allowed per second before we should start throttling. */
  requestsPerSecond: number;
}

export interface ChainAdapterConfig {
  chainId: number;
  vendor: ChainVendor;
  baseUrl: string;
  apiKeyEnv: string;
  rateBudget: ChainRateBudget;
  supported: boolean;
}

const DEFAULT_RATE_BUDGET: ChainRateBudget = {
  requestsPerSecond: 5,
};

export const CHAIN_ADAPTERS: Record<number, ChainAdapterConfig> = {
  1: {
    chainId: 1,
    vendor: "etherscan",
    baseUrl: "https://api.etherscan.io/api",
    apiKeyEnv: "ETHERSCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  10: {
    chainId: 10,
    vendor: "etherscan",
    baseUrl: "https://api-optimistic.etherscan.io/api",
    apiKeyEnv: "OPTIMISTICSCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  56: {
    chainId: 56,
    vendor: "etherscan",
    baseUrl: "https://api.bscscan.com/api",
    apiKeyEnv: "BSCSCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  137: {
    chainId: 137,
    vendor: "etherscan",
    baseUrl: "https://api.polygonscan.com/api",
    apiKeyEnv: "POLYGONSCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  42161: {
    chainId: 42161,
    vendor: "etherscan",
    baseUrl: "https://api.arbiscan.io/api",
    apiKeyEnv: "ARBISCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  43114: {
    chainId: 43114,
    vendor: "etherscan",
    baseUrl: "https://api.snowtrace.io/api",
    apiKeyEnv: "SNOWTRACE_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  8453: {
    chainId: 8453,
    vendor: "etherscan",
    baseUrl: "https://api.basescan.org/api",
    apiKeyEnv: "BASESCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  324: {
    chainId: 324,
    vendor: "etherscan",
    baseUrl: "https://api.zksync.io/api",
    apiKeyEnv: "ZKSYNC_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  5000: {
    chainId: 5000,
    vendor: "etherscan",
    baseUrl: "https://api.mantlescan.xyz/api",
    apiKeyEnv: "MANTLESCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: true,
  },
  25: {
    chainId: 25,
    vendor: "etherscan",
    baseUrl: "https://api.cronoscan.com/api",
    apiKeyEnv: "CRONOSCAN_API_KEY",
    rateBudget: DEFAULT_RATE_BUDGET,
    supported: false,
  },
};

export function getChainAdapter(chainId: number): ChainAdapterConfig | undefined {
  return CHAIN_ADAPTERS[chainId];
}

export function isChainSupported(chainId: number): boolean {
  const adapter = getChainAdapter(chainId);
  return Boolean(adapter && adapter.supported);
}
