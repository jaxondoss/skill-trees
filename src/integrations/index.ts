import { chessAdapter } from "./chess";
import { lyftaAdapter } from "./lyfta";
import { canvasAdapter, googleCalendarAdapter, stravaAdapter } from "./pending";
import type { IntegrationAdapter, ProviderId } from "./types";

/** In the order spec Phase 6 builds them. */
export const ADAPTERS: IntegrationAdapter[] = [
  chessAdapter as IntegrationAdapter,
  lyftaAdapter as IntegrationAdapter,
  stravaAdapter,
  googleCalendarAdapter,
  canvasAdapter,
];
export const adapterFor = (id: ProviderId) => ADAPTERS.find((a) => a.id === id);
