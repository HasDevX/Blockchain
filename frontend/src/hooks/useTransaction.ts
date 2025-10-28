import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchTransaction } from "../lib/api";
import type { TransactionDetails } from "../types/api";

export function useTransaction(chainId: number | null, hash: string | null) {
  return useSWR<TransactionDetails>(
    chainId && hash ? ["transaction", chainId, hash.toLowerCase()] : null,
    () => fetchTransaction(chainId as number, hash as string),
    {
      onError: (error: unknown) => {
        console.error(error);
        toast.error("Unable to load transaction");
      },
    },
  );
}
