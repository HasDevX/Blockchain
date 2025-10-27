import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchAdminSettings } from "../lib/api";
import type { AdminSettings } from "../types/api";

export function useAdminSettings(token: string | null) {
  return useSWR<AdminSettings>(token ? ["admin-settings", token] : null, () => fetchAdminSettings(token as string), {
    onError: (error: unknown) => {
      console.error(error);
      toast.error("Unable to load admin settings");
    },
  });
}
