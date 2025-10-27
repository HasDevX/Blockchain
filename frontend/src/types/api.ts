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
  address: string;
  balance: string;
  percentage: number;
}

export interface TokenHoldersPayload {
  items: TokenHolder[];
  nextCursor: string | null;
}

export interface AdminSettings {
  settings: {
    maintenanceMode: boolean;
    lastUpdatedBy: string;
    announcement: string | null;
  };
}
