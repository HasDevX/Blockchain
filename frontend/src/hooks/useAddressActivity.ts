import { useMemo } from "react";
import useSWR from "swr";
import toast from "react-hot-toast";
import { fetchAddressActivity } from "../lib/api";
import type { AddressActivityResponse } from "../types/api";

interface Options {
  cursor?: string | null;
  limit?: number;
}

export function useAddressActivity(
  chainId: number | null,
  address: string | null,
  options: Options,
) {
  const key = useMemo(
    () =>
      chainId && address
        ? ["address-activity", chainId, address.toLowerCase(), options.cursor, options.limit]
        : null,
    [chainId, address, options.cursor, options.limit],
  );

  return useSWR<AddressActivityResponse>(
    key,
    () => fetchAddressActivity(chainId as number, address as string, options),
    {
      keepPreviousData: true,
      onError: (error: unknown) => {
        console.error(error);
        toast.error("Unable to load address activity");
      },
    },
  );
}
