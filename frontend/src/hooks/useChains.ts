import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchChains } from "../lib/api";
import type { Chain } from "../types/api";

export function useChains() {
  return useSWR<Chain[]>("chains", fetchChains, {
    onError: (error: unknown) => {
      console.error(error);
      toast.error("Failed to load chains");
    },
  });
}
