import { loadEnv } from "./env";
import { SUPPORTED_CHAIN_IDS } from "./chains";

export function getRpcUrl(chainId: number): string {
  const env = loadEnv();
  const url = env.rpcUrls[chainId];

  if (!url) {
    if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)) {
      throw new Error(`RPC URL requested for unsupported chain ${chainId}`);
    }

    throw new Error(`RPC_${chainId} is not configured`);
  }

  return url;
}
