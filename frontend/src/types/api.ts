export interface Chain {
  id: number;
  key: string;
  name: string;
  shortName: string;
  nativeSymbol: string;
  explorerUrl: string;
  supported: boolean;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  uptime: number;
  services?: {
    database: string;
    redis: string;
  };
}

export interface TokenSummary {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  totalSupply: string;
  holdersCount: number;
  supported: boolean;
  explorerUrl: string;
}

export interface TokenHolder {
  rank: number;
  holder: string;
  balance: string;
  pct: number;
}

export interface TokenHoldersPayload {
  items: TokenHolder[];
  nextCursor?: string;
  status?: "ok" | "indexing";
}

export interface TransactionLog {
  index: number;
  address: string;
  topics: Array<string | null>;
  data: string | null;
}

export interface TokenTransferEntry {
  logIndex: number;
  token: string;
  from: string;
  to: string;
  value: string;
}

export interface TransactionDetails {
  chainId: number;
  hash: string;
  blockNumber: string;
  blockHash: string | null;
  timestamp: string | null;
  from: string;
  to: string | null;
  value: string;
  nonce: string;
  gas: string | null;
  gasPrice: string | null;
  input: string | null;
  methodSignature: string | null;
  methodSelector: string | null;
  status: boolean | null;
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  contractAddress: string | null;
  logs: TransactionLog[];
  tokenTransfers: TokenTransferEntry[];
}

export interface AddressActivityItem {
  txHash: string;
  logIndex: number;
  blockNumber: string;
  timestamp: string | null;
  token: string;
  from: string;
  to: string;
  value: string;
  direction: "in" | "out";
}

export interface AddressActivityResponse {
  items: AddressActivityItem[];
  tokenTransfers: AddressActivityItem[];
  transactions: AddressActivityTransaction[];
  nextCursor?: string;
}

export interface AddressActivityTransaction {
  hash: string;
  blockNumber: string;
  timestamp: string | null;
  from: string;
  to: string | null;
  value: string;
  status: boolean | null;
  tokenTransfers: AddressActivityItem[];
}

export interface TokenChainCoverageEntry {
  chainId: number;
  supported: boolean;
  status: "ok" | "indexing";
  fromBlock: string | null;
  toBlock: string | null;
  updatedAt: string | null;
  lastTransferBlock: string | null;
  lastTransferAt: string | null;
  transferCount: number;
}

export interface AdminSettings {
  settings: {
    maintenanceMode: boolean;
    lastUpdatedBy: string;
    announcement: string | null;
  };
}

export interface AdminConnectionEndpoint {
  id: string;
  chainId: number;
  label: string | null;
  url: string;
  isPrimary: boolean;
  enabled: boolean;
  qps: number;
  minSpan: number;
  maxSpan: number;
  weight: number;
  orderIndex: number;
  lastHealth: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
}

export interface AdminConnectionChain {
  chainId: number;
  name: string;
  endpoints: AdminConnectionEndpoint[];
}

export interface AdminConnectionsResponse {
  chains: AdminConnectionChain[];
}

export type AdminRpcTestResult = AdminRpcTestSuccess | AdminRpcTestFailure;

export interface AdminRpcTestSuccess {
  ok: true;
  tip: string;
  latencyMs: number;
}

export interface AdminRpcTestFailure {
  ok: false;
  error: string;
  message?: string;
  status?: number;
}
