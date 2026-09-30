import useSWR from "swr";
import type { GetLlmStatusResponse } from "@/app/api/user/llm-status/route";

const REFRESH_INTERVAL_MS = 60_000;

export function useLlmStatus() {
  return useSWR<GetLlmStatusResponse>("/api/user/llm-status", {
    refreshInterval: REFRESH_INTERVAL_MS,
  });
}
