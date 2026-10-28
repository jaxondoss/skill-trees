import { z } from "zod";
import type { IntegrationAdapter } from "./types";

/**
 * Google Calendar, read-only, for the calendar wall in the room. Per Google's OAuth 2.0 web server
 * flow and the Calendar API v3 reference:
 *   GET  https://accounts.google.com/o/oauth2/v2/auth             consent screen (offline access)
 *   POST https://oauth2.googleapis.com/token                      code or refresh token -> access token
 *   GET  https://www.googleapis.com/calendar/v3/users/me/calendarList
 *   GET  https://www.googleapis.com/calendar/v3/colors
 *   GET  https://www.googleapis.com/calendar/v3/calendars/{id}/events
 * Events are read live for the wall; nothing is written to the app's tables. Adding an event opens
 * Google Calendar itself, so the scope never needs write access.
 */
/** Holds the OAuth state between /api/google/connect and /api/google/callback. */
export const GOOGLE_STATE_COOKIE = "forge_google_oauth_state";
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 10;
/** Google's default calendar colour (Peacock), used only if a calendar reports none at all. */
const DEFAULT_COLOR = "#039be5";

export type CalendarEvent = {
  /** Unique across calendars: "<calendarId>:<eventId>" (the same event can sit on two calendars). */
  id: string;
  calendarId: string;
  /** The calendar's name as the user sees it (their override, else its title). */
  calendar: string;
  title: string;
  /** RFC 3339 date-time for timed events; YYYY-MM-DD for all-day ones (end is exclusive, as Google sends it). */
  start: string;
  end: string;
  allDay: boolean;
  /** "#rrggbb", lowercase, exactly the colour Google shows the event in. */
  color: string;
  htmlLink?: string;
};

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresAt: number };

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const hex = (v: unknown) => {
  const s = str(v)?.toLowerCase() ?? null;
  return s && /^#[0-9a-f]{6}$/.test(s) ? s : null;
};

export function authUrl({ clientId, redirectUri, state }: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

/** Posts to the token endpoint. Error text carries Google's error code and description, never a token. */
async function tokenRequest(params: Record<string, string>, fetchImpl: typeof fetch, now: number): Promise<GoogleTokens> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = obj(await res.json().catch(() => null));
  if (!res.ok || !str(body?.access_token)) {
    const code = str(body?.error);
    if (code === "invalid_grant") throw new Error("Google access was revoked or has expired. Connect Google Calendar again.");
    const detail = str(body?.error_description) ?? code ?? `HTTP ${res.status}`;
    throw new Error(`Google sign-in failed: ${detail}`);
  }
  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken: body!.access_token as string, refreshToken: str(body?.refresh_token), expiresAt: now + expiresIn * 1000 };
}

/** Trades the one-time code from the callback for tokens. Throws when Google sends no refresh token. */
export async function exchangeCode(
  { code, clientId, clientSecret, redirectUri }: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number }> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }, fetchImpl, now);
  if (!t.refreshToken) {
    throw new Error("Google sent no refresh token. Remove FORGE under myaccount.google.com/permissions, then connect again.");
  }
  return { refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt };
}

export async function refreshAccessToken(
  refreshToken: string,
  { clientId, clientSecret }: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<{ accessToken: string; expiresAt: number }> {
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }, fetchImpl, now);
  return { accessToken: t.accessToken, expiresAt: t.expiresAt };
}

async function getJson(url: string, accessToken: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const body = obj(await res.json().catch(() => null));
  if (!res.ok) {
    const message = str(obj(body?.error)?.message) ?? `HTTP ${res.status}`;
    throw new Error(`Google Calendar: ${message}`);
  }
  return body ?? {};
}

/** Follows nextPageToken, up to MAX_PAGES, and returns every item. */
async function allItems(base: string, params: Record<string, string>, accessToken: string, fetchImpl: typeof fetch): Promise<unknown[]> {
  const items: unknown[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams(params);
    if (pageToken) q.set("pageToken", pageToken);
    const body = await getJson(`${base}?${q}`, accessToken, fetchImpl);
    items.push(...arr(body.items));
    pageToken = str(body.nextPageToken);
    if (!pageToken) break;
  }
  return items;
}

type Colors = { event: Record<string, unknown>; calendar: Record<string, unknown> };
const paletteColor = (palette: Record<string, unknown>, id: unknown) => {
  const key = str(id);
  return key ? hex(obj(palette[key])?.background) : null;
};

type CalendarInfo = { id: string; name: string; color: string };

/** Calendars the user shows in Google Calendar: hidden ones are skipped, unselected ones too. */
export function visibleCalendars(items: unknown[], colors: Colors): CalendarInfo[] {
  return items.flatMap((c): CalendarInfo[] => {
    const o = obj(c);
    const id = str(o?.id);
    if (!o || !id || o.hidden === true || o.selected === false) return [];
    const color = hex(o.backgroundColor) ?? paletteColor(colors.calendar, o.colorId) ?? DEFAULT_COLOR;
    return [{ id, name: str(o.summaryOverride) ?? str(o.summary) ?? id, color }];
  });
}

/** One Google event to the wall's shape, or null when Google would not show it (cancelled, declined). */
export function mapEvent(e: unknown, cal: CalendarInfo, colors: Colors): CalendarEvent | null {
  const o = obj(e);
  const id = str(o?.id);
  if (!o || !id || o.status === "cancelled") return null;
  const declined = arr(o.attendees).some((a) => obj(a)?.self === true && obj(a)?.responseStatus === "declined");
  if (declined) return null;
  const start = obj(o.start);
  const end = obj(o.end);
  const allDay = Boolean(str(start?.date)) && !str(start?.dateTime);
  const s = allDay ? str(start?.date) : str(start?.dateTime);
  const f = (allDay ? str(end?.date) : str(end?.dateTime)) ?? s;
  if (!s || !f) return null;
  return {
    id: `${cal.id}:${id}`,
    calendarId: cal.id,
    calendar: cal.name,
    title: str(o.summary) ?? "(No title)",
    start: s,
    end: f,
    allDay,
    color: paletteColor(colors.event, o.colorId) ?? cal.color,
    ...(str(o.htmlLink) ? { htmlLink: o.htmlLink as string } : {}),
  };
}

/** Every event on every shown calendar between timeMin and timeMax, in Google's colours, sorted by start. */
export async function listEvents(
  { accessToken, timeMin, timeMax, timeZone }: { accessToken: string; timeMin: string; timeMax: string; timeZone?: string },
  fetchImpl: typeof fetch,
): Promise<CalendarEvent[]> {
  const [list, palette] = await Promise.all([
    allItems(`${API}/users/me/calendarList`, { maxResults: "250" }, accessToken, fetchImpl),
    getJson(`${API}/colors`, accessToken, fetchImpl),
  ]);
  const colors: Colors = { event: obj(palette.event) ?? {}, calendar: obj(palette.calendar) ?? {} };
  const calendars = visibleCalendars(list, colors);

  const params: Record<string, string> = { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", showDeleted: "false", maxResults: "250" };
  if (timeZone) params.timeZone = timeZone;
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      const items = await allItems(`${API}/calendars/${encodeURIComponent(cal.id)}/events`, params, accessToken, fetchImpl);
      return items.map((e) => mapEvent(e, cal, colors)).filter((e): e is CalendarEvent => e !== null);
    }),
  );
  return perCalendar.flat().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

// ───────────────────────────── Adapter

const Config = z.object({ connectedAt: z.string().optional() });
export type GoogleCalendarConfig = z.infer<typeof Config>;

const NEEDS = [
  "a Google Cloud OAuth client (web application) with the calendar read scope",
  "the redirect URL https://<your domain>/api/google/callback added to that client",
  "its client ID and secret as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel",
];

export function googleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

const available = googleConfigured();

/**
 * Connecting runs through /api/google/connect (OAuth), not connect(). The wall reads events live,
 * so sync and mapToEvents write nothing to the app's tables.
 */
export const googleCalendarAdapter: IntegrationAdapter<GoogleCalendarConfig, null> = {
  id: "google_calendar",
  label: "Google Calendar",
  feeds: "The calendar wall in the room: every calendar, in its Google colours.",
  fallback: { label: "Open Google Calendar", href: "https://calendar.google.com" },
  available,
  needs: NEEDS,
  connect(input) {
    if (!available) throw new Error(`Google Calendar is not set up yet. Needs: ${NEEDS.join("; ")}.`);
    return Config.parse(input ?? {});
  },
  sync: async () => null,
  mapToEvents: () => [],
};
