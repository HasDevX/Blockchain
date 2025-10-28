import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchTokenChainCoverage } from "../lib/api";
import type { TokenChainCoverageEntry } from "../types/api";

export function useTokenChainCoverage(address: string | null) {
  return useSWR<TokenChainCoverageEntry[]>(
    address ? ["token-chain-coverage", address.toLowerCase()] : null,
    () => fetchTokenChainCoverage(address as string),
    {
      onError: (error: unknown) => {
        console.error(error);
        toast.error("Unable to load token chains");
      },
    },
  );
}
