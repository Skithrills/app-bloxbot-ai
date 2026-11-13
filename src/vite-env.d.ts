/// <reference types="vite/client" />

import type { DesktopApi } from "@/types/desktop";

declare global {
  interface ImportMetaEnv {}

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    bloxbot?: DesktopApi;
  }
}
