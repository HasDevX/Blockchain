import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchHealth } from "../lib/api";
import type { HealthResponse } from "../types/api";

export function useHealth() {
  return useSWR<HealthResponse>("health", fetchHealth, {
    refreshInterval: 60_000,
    onError: (error: unknown) => {
      console.error(error);
      toast.error("Health endpoint unavailable");
    },
  });
}
