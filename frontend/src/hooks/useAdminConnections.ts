import useSWR from "swr";
import { ApiError, fetchAdminConnections } from "../lib/api";
import type { AdminConnectionsResponse } from "../types/api";

export function useAdminConnections(token: string | null) {
  return useSWR<AdminConnectionsResponse>(
    ["admin-connections", token ?? ""],
    () => fetchAdminConnections(token),
    {
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          return;
        }

        console.error(error);
      },
      revalidateOnFocus: false,
    },
  );
}
