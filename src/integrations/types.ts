import type { Tier } from "@/engine/types";

export type ProviderId = "chess" | "google_calendar" | "canvas" | "lyfta" | "claude" | "gemini" | "strava";

/** What an integration produces. The app applies these the same way manual entries are stored. */
export type IntegrationEvent =
  | { kind: "metric"; skillSlug: string; key: string; value: number; day: string }
  | { kind: "assignment"; externalId: string; course: string | null; name: string; dueAt: string; started: boolean; submitted: boolean }
  | { kind: "goal_complete"; skillSlug: string; tier: Tier; day: string };

/**
 * Shared adapter interface (spec 13): connect validates settings, sync fetches raw data,
 * mapToEvents turns it into app events. Every adapter has a manual-entry fallback, so the app
 * works fully with none of them connected.
 */
export interface IntegrationAdapter<Config = unknown, Raw = unknown> {
  id: ProviderId;
  label: string;
  /** Which skills it feeds and how. */
  feeds: string;
  /** Where to enter the same data by hand while it is not connected. */
  fallback: { label: string; href: string };
  /** Built and ready to connect. False until the docs or credentials it needs are provided. */
  available: boolean;
  /** What is still needed from the user before it can be built or connected. */
  needs: string[];
  /** A server env var that holds the API key, used when no token is stored for the connection. */
  envKey?: string;
  connect(input: unknown): Config;
  sync(config: Config, secret: string | null, fetchImpl: typeof fetch): Promise<Raw>;
  mapToEvents(raw: Raw, ctx: { today: string; config: Config; timeZone?: string; rolloverHour?: number }): IntegrationEvent[];
}
