import { createContext, useContext } from "react";
import type { OpencodeClient } from "@/lib/opencode/client";

export type AppStatus = "waiting" | "ready" | "error";

export interface OpenCodeClientContextValue {
  client: OpencodeClient | null;
  status: AppStatus;
  port: number;
  ready: boolean;
  initError: string | null;
}

// Keep the context identity stable when Vite reloads the provider during development.
export const OpenCodeClientContext = createContext<OpenCodeClientContextValue>({
  client: null,
  status: "waiting",
  port: 0,
  ready: false,
  initError: null,
});

export function useOpenCodeClient() {
  return useContext(OpenCodeClientContext);
}
