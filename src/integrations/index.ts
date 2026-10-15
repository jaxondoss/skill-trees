import { chessAdapter } from "./chess";
import { canvasAdapter, claudeAdapter, googleCalendarAdapter, liftaAdapter } from "./pending";
import type { IntegrationAdapter, ProviderId } from "./types";

/** In the order spec Phase 6 builds them. */
export const ADAPTERS: IntegrationAdapter[] = [chessAdapter as IntegrationAdapter, googleCalendarAdapter, canvasAdapter, liftaAdapter, claudeAdapter];
export const adapterFor = (id: ProviderId) => ADAPTERS.find((a) => a.id === id);
