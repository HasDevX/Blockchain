import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchTokenHolders } from "../lib/api";
import type { TokenHoldersPayload } from "../types/api";

interface Options {
  cursor?: string | null;
  limit?: number;
}

export function useTokenHolders(chainId: number | null, address: string | null, options: Options) {
  return useSWR<TokenHoldersPayload>(
    chainId && address ? ["token-holders", chainId, address, options.cursor, options.limit] : null,
    () => fetchTokenHolders(chainId as number, address as string, options),
    {
      keepPreviousData: true,
      onError: (error: unknown) => {
        console.error(error);
        toast.error("Unable to load holders");
      },
    },
  );
}
