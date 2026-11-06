"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWallet } from "./useWallet";

/** GET with optional polling (min 3 s). `poll` decides from the data whether to keep polling. */
export function useApi<T>(key: unknown[], path: string | null, opts: { poll?: (d: T | undefined) => boolean } = {}) {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: () => api<T>(path as string),
    enabled: path !== null,
    retry: (n, e) => e.isInfra && n < 1,
    refetchInterval: (q) => (opts.poll && opts.poll(q.state.data) ? 3000 : false),
  });
}

export function useMe() {
  const { signedIn } = useWallet();
  return useApi<{ id: string; address: string }>(["me", signedIn], signedIn ? "/me" : null);
}
