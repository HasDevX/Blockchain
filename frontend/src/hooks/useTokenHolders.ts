import { useEffect, useMemo, useRef } from "react";
import useSWR from "swr";
import toast from "react-hot-toast";
import { ApiError, fetchTokenHolders } from "../lib/api";
import type { TokenHoldersPayload } from "../types/api";

interface Options {
  cursor?: string | null;
  limit?: number;
}

const INDEXING_REFRESH_MS = 10_000;
const INDEXING_REFRESH_WINDOW_MS = 120_000;

export function useTokenHolders(chainId: number | null, address: string | null, options: Options) {
  const swrKey = useMemo(
    () =>
      chainId && address
        ? ["token-holders", chainId, address, options.cursor, options.limit]
        : null,
    [chainId, address, options.cursor, options.limit],
  );

  const signature = useMemo(
    () =>
      chainId && address
        ? `${chainId}:${address}:${options.cursor ?? ""}:${options.limit ?? ""}`
        : null,
    [chainId, address, options.cursor, options.limit],
  );

  const indexingStartRef = useRef<number | null>(null);
  const indexingLimitReachedRef = useRef(false);

  const swr = useSWR<TokenHoldersPayload>(
    swrKey,
    () => fetchTokenHolders(chainId as number, address as string, options),
    {
      keepPreviousData: true,
      onError: (error: unknown) => {
        console.error(error);
        if (error instanceof ApiError && error.status === 429) {
          return;
        }
        toast.error("Unable to load holders");
      },
    },
  );

  const status = swr.data?.status;
  const mutate = swr.mutate;

  useEffect(() => {
    indexingStartRef.current = null;
    indexingLimitReachedRef.current = false;
  }, [signature]);

  useEffect(() => {
    if (status === "indexing") {
      if (!indexingLimitReachedRef.current && indexingStartRef.current === null) {
        indexingStartRef.current = Date.now();
      }
    } else {
      indexingStartRef.current = null;
      indexingLimitReachedRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (status !== "indexing") {
      return;
    }

    if (indexingLimitReachedRef.current) {
      return;
    }

    const startedAt = indexingStartRef.current;

    if (startedAt === null) {
      return;
    }

    const initialElapsed = Date.now() - startedAt;

    if (initialElapsed >= INDEXING_REFRESH_WINDOW_MS) {
      indexingStartRef.current = null;
      indexingLimitReachedRef.current = true;
      return;
    }

    const intervalId = window.setInterval(() => {
      if (indexingStartRef.current === null) {
        window.clearInterval(intervalId);
        return;
      }

      const elapsed = Date.now() - indexingStartRef.current;

      if (elapsed >= INDEXING_REFRESH_WINDOW_MS) {
        indexingStartRef.current = null;
        indexingLimitReachedRef.current = true;
        window.clearInterval(intervalId);
        return;
      }

      void mutate();
    }, INDEXING_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [status, mutate]);

  return swr;
}
