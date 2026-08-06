import type { KanApi } from "./index";

declare global {
  interface Window {
    kan: KanApi;
  }
}
