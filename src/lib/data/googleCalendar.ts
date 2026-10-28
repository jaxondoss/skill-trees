import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, parseKey } from "@/integrations/crypto";
import { listEvents, refreshAccessToken, type CalendarEvent } from "@/integrations/googleCalendar";

export type CalendarWall = { connected: boolean; events: CalendarEvent[]; error?: string };

const CACHE_MS = 2 * 60_000;
/** Per server instance. Keyed by user; each entry remembers which stored login it came from. */
const tokens = new Map<string, { sealed: string; accessToken: string; expiresAt: number }>();
const events = new Map<string, { sealed: string; at: number; events: CalendarEvent[] }>();

async function accessTokenFor(uid: string, sealed: string, client: { clientId: string; clientSecret: string }): Promise<string> {
  const hit = tokens.get(uid);
  if (hit && hit.sealed === sealed && hit.expiresAt - 60_000 > Date.now()) return hit.accessToken;
  const refreshToken = decryptSecret(sealed, parseKey(process.env.INTEGRATIONS_KEY));
  const t = await refreshAccessToken(refreshToken, client, fetch);
  tokens.set(uid, { sealed, ...t });
  return t.accessToken;
}

/**
 * The owner's Google Calendar events for the calendar wall, read live. Records the outcome on the
 * integrations row the way syncProvider does. Never throws.
 */
export async function loadCalendarEvents(
  supabase: SupabaseClient,
  range: { timeMin: string; timeMax: string; timeZone?: string },
): Promise<CalendarWall> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { connected: false, events: [], error: "not configured" };

  try {
    const { data: claims } = await supabase.auth.getClaims();
    const uid = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (!uid) return { connected: false, events: [], error: "Sign in again." };
    const { data } = await supabase.from("integrations").select("secret_ciphertext").eq("provider", "google_calendar").maybeSingle();
    const sealed = (data as { secret_ciphertext: string | null } | null)?.secret_ciphertext;
    if (!sealed) return { connected: false, events: [] };

    const key = `${uid}|${range.timeMin}|${range.timeMax}|${range.timeZone ?? ""}`;
    const hit = events.get(key);
    if (hit && hit.sealed === sealed && Date.now() - hit.at < CACHE_MS) return { connected: true, events: hit.events };

    try {
      const accessToken = await accessTokenFor(uid, sealed, { clientId, clientSecret });
      const list = await listEvents({ accessToken, ...range }, fetch);
      events.set(key, { sealed, at: Date.now(), events: list });
      await supabase.from("integrations").update({ status: "connected", last_synced_at: new Date().toISOString(), last_error: null }).eq("provider", "google_calendar");
      return { connected: true, events: list };
    } catch (err) {
      tokens.delete(uid);
      const error = err instanceof Error ? err.message : "Could not read Google Calendar.";
      await supabase.from("integrations").update({ status: "error", last_synced_at: new Date().toISOString(), last_error: error }).eq("provider", "google_calendar");
      return { connected: true, events: [], error };
    }
  } catch (err) {
    return { connected: false, events: [], error: err instanceof Error ? err.message : "Could not read Google Calendar." };
  }
}
