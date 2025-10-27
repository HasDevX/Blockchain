import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchToken } from "../lib/api";
import type { TokenSummary } from "../types/api";

export function useToken(chainId: number | null, address: string | null) {
  return useSWR<TokenSummary>(
    chainId && address ? ["token", chainId, address] : null,
    () => fetchToken(chainId as number, address as string),
    {
      onError: (error: unknown) => {
        console.error(error);
        toast.error("Unable to load token details");
      },
    },
  );
}
