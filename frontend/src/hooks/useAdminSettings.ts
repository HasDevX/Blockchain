import useSWR from "swr";
import toast from "react-hot-toast";
import { ApiError, fetchAdminSettings } from "../lib/api";
import type { AdminSettings } from "../types/api";

export function useAdminSettings(token: string | null) {
  return useSWR<AdminSettings>(
    ["admin-settings", token ?? ""],
    () => fetchAdminSettings(token),
    {
      onError: (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          return;
        }

        console.error(error);
        toast.error("Unable to load admin settings");
      },
    },
  );
}
