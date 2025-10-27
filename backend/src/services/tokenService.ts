import { CHAINS, getChainById } from "../config/chains";
import { loadEnv } from "../config/env";
import { EtherscanClient } from "../vendors/etherscanClient";

const etherscanClient = new EtherscanClient(loadEnv().etherscanApiKey);

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

export interface TokenHoldersResponse {
  items: TokenHolder[];
  nextCursor: string | null;
}

export async function getTokenSummary(chainId: number, tokenAddress: string): Promise<TokenSummary | null> {
  const chain = getChainById(chainId);

  if (!chain) {
    return null;
  }

  const checksumAddress = tokenAddress.toLowerCase();

  const vendorInfo = await etherscanClient.getTokenInfo(chainId, checksumAddress);

  return {
    chainId,
    address: checksumAddress,
    name: vendorInfo?.name ?? `Sample Token (${chain.shortName})`,
    symbol: vendorInfo?.symbol ?? `${chain.shortName}T`,
    priceUsd: 1.23,
    totalSupply: vendorInfo?.totalSupply ?? "1000000000000000000000000",
    holdersCount: 1284,
    supported: chain.supported,
    explorerUrl: chain.explorerUrl,
  };
}

export function getTokenHolders(
  chainId: number,
  tokenAddress: string,
  cursor: string | null,
  limit: number,
): TokenHoldersResponse | null {
  const chain = getChainById(chainId);

  if (!chain) {
    return null;
  }

  const baseSeed = cursor ? Number(cursor) : 0;

  const items = Array.from({ length: limit }, (_, index) => {
    const rank = baseSeed + index + 1;
    const suffix = (baseSeed + index).toString(16).padStart(4, "0");

    return {
      rank,
      address: `0xholder${suffix}`.padEnd(42, "0"),
      balance: (1000000 - rank * 10).toString(),
      percentage: Math.max(0.01, Number((100 / (rank + 10)).toFixed(2))),
    } satisfies TokenHolder;
  });

  const hasMore = baseSeed + limit < 500;
  const nextCursor = hasMore ? String(baseSeed + limit) : null;

  return {
    items,
    nextCursor,
  };
}

export function listChains() {
  return CHAINS;
}
