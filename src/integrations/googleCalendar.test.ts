import { describe, expect, it } from "vitest";
import { authUrl, exchangeCode, GOOGLE_SCOPE, googleCalendarAdapter, googleConfigured, listEvents, refreshAccessToken } from "./googleCalendar";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake Google: routes by path, records every URL it was asked for. */
function fakeGoogle(routes: Record<string, unknown | ((url: URL) => unknown)>) {
  const calls: URL[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer at-1");
    const route = routes[url.pathname];
    if (route === undefined) return json({ error: { message: `no route ${url.pathname}` } }, 404);
    return json(typeof route === "function" ? (route as (u: URL) => unknown)(url) : route);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const COLORS = {
  event: { "11": { background: "#DC2127", foreground: "#1d1d1d" } },
  calendar: { "7": { background: "#42D692", foreground: "#1d1d1d" } },
};
const RANGE = { accessToken: "at-1", timeMin: "2026-10-26T00:00:00Z", timeMax: "2026-11-02T00:00:00Z", timeZone: "America/Chicago" };
const timed = (id: string, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "confirmed",
  summary: id,
  start: { dateTime: start },
  end: { dateTime: start.replace("T09", "T10") },
  htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
  ...extra,
});

describe("Google Calendar OAuth", () => {
  it("asks for read-only, offline access with consent", () => {
    const url = new URL(authUrl({ clientId: "cid", redirectUri: "https://forge.example/api/google/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      client_id: "cid",
      redirect_uri: "https://forge.example/api/google/callback",
      response_type: "code",
      scope: GOOGLE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: "s1",
    });
    expect(GOOGLE_SCOPE).toBe("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("exchanges a code for tokens", async () => {
    let body = "";
    const f = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      body = String(init.body);
      return json({ access_token: "at", refresh_token: "rt", expires_in: 3599 });
    }) as unknown as typeof fetch;
    const t = await exchangeCode({ code: "c1", clientId: "cid", clientSecret: "sec", redirectUri: "https://x/cb" }, f, 1_000);
    expect(t).toEqual({ accessToken: "at", refreshToken: "rt", expiresAt: 1_000 + 3_599_000 });
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({ grant_type: "authorization_code", code: "c1", client_id: "cid", client_secret: "sec", redirect_uri: "https://x/cb" });
  });

  it("explains token errors without leaking secrets", async () => {
    const noRefresh = (async () => json({ access_token: "at", expires_in: 3600 })) as unknown as typeof fetch;
    await expect(exchangeCode({ code: "c", clientId: "cid", clientSecret: "sec", redirectUri: "r" }, noRefresh)).rejects.toThrow(/no refresh token/);

    const bad = (async () => json({ error: "invalid_client", error_description: "The OAuth client was not found." }, 401)) as unknown as typeof fetch;
    const err = await exchangeCode({ code: "c", clientId: "cid", clientSecret: "sec", redirectUri: "r" }, bad).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/OAuth client was not found/);
    expect((err as Error).message).not.toContain("sec");

    const revoked = (async () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)) as unknown as typeof fetch;
    await expect(refreshAccessToken("rt", { clientId: "cid", clientSecret: "sec" }, revoked)).rejects.toThrow(/Connect Google Calendar again/);

    const garbage = (async () => new Response("<html>", { status: 500 })) as unknown as typeof fetch;
    await expect(refreshAccessToken("rt", { clientId: "cid", clientSecret: "sec" }, garbage)).rejects.toThrow(/HTTP 500/);
  });

  it("refreshes an access token", async () => {
    const f = (async (_u: string, init: RequestInit) => {
      expect(new URLSearchParams(String(init.body)).get("grant_type")).toBe("refresh_token");
      return json({ access_token: "fresh", expires_in: 100 });
    }) as unknown as typeof fetch;
    expect(await refreshAccessToken("rt", { clientId: "cid", clientSecret: "sec" }, f, 0)).toEqual({ accessToken: "fresh", expiresAt: 100_000 });
  });
});

describe("Google Calendar events", () => {
  const calendarList = {
    items: [
      { id: "me@gmail.com", summary: "me@gmail.com", summaryOverride: "Personal", backgroundColor: "#9FE1E7", colorId: "14", selected: true, primary: true },
      { id: "class", summary: "Classes", colorId: "7" },
      { id: "hidden", summary: "Hidden", backgroundColor: "#000000", hidden: true },
      { id: "off", summary: "Unticked", backgroundColor: "#111111", selected: false },
    ],
  };

  it("lists shown calendars and colours events exactly as Google does", async () => {
    const { impl, calls } = fakeGoogle({
      "/calendar/v3/users/me/calendarList": calendarList,
      "/calendar/v3/colors": COLORS,
      "/calendar/v3/calendars/me%40gmail.com/events": {
        items: [
          timed("gym", "2026-10-27T09:00:00-05:00"),
          timed("dentist", "2026-10-26T09:00:00-05:00", { colorId: "11" }),
          { id: "trip", status: "confirmed", summary: "Trip", start: { date: "2026-10-28" }, end: { date: "2026-10-30" } },
          { id: "untitled", start: { dateTime: "2026-10-29T09:00:00-05:00" }, end: { dateTime: "2026-10-29T09:30:00-05:00" } },
        ],
      },
      "/calendar/v3/calendars/class/events": { items: [timed("bio", "2026-10-27T09:00:00-05:00")] },
    });
    const events = await listEvents(RANGE, impl);

    expect(calls.some((u) => u.pathname.includes("hidden") || u.pathname.includes("/off/"))).toBe(false);
    expect(calls.filter((u) => u.pathname === "/calendar/v3/colors")).toHaveLength(1);
    const q = Object.fromEntries(calls.find((u) => u.pathname.endsWith("/class/events"))!.searchParams);
    expect(q).toMatchObject({ singleEvents: "true", orderBy: "startTime", showDeleted: "false", timeMin: RANGE.timeMin, timeMax: RANGE.timeMax, timeZone: "America/Chicago" });

    expect(events.map((e) => e.id)).toEqual(["me@gmail.com:dentist", "me@gmail.com:gym", "class:bio", "me@gmail.com:trip", "me@gmail.com:untitled"]);
    const by = Object.fromEntries(events.map((e) => [e.id.split(":")[1], e]));
    expect(by.dentist.color).toBe("#dc2127"); // event colorId wins
    expect(by.gym.color).toBe("#9fe1e7"); // calendar backgroundColor, lowercased
    expect(by.bio.color).toBe("#42d692"); // calendar colorId when no backgroundColor
    expect(by.gym).toEqual({
      id: "me@gmail.com:gym",
      calendarId: "me@gmail.com",
      calendar: "Personal",
      title: "gym",
      start: "2026-10-27T09:00:00-05:00",
      end: "2026-10-27T10:00:00-05:00",
      allDay: false,
      color: "#9fe1e7",
      htmlLink: "https://www.google.com/calendar/event?eid=gym",
    });
    expect(by.bio.calendar).toBe("Classes");
    expect(by.trip).toMatchObject({ allDay: true, start: "2026-10-28", end: "2026-10-30" });
    expect(by.untitled.title).toBe("(No title)");
    expect(by.untitled.htmlLink).toBeUndefined();
  });

  it("skips declined and cancelled events", async () => {
    const { impl } = fakeGoogle({
      "/calendar/v3/users/me/calendarList": { items: [{ id: "c", summary: "C", backgroundColor: "#123456" }] },
      "/calendar/v3/colors": COLORS,
      "/calendar/v3/calendars/c/events": {
        items: [
          timed("kept", "2026-10-27T09:00:00Z", { attendees: [{ email: "me", self: true, responseStatus: "accepted" }, { email: "x", responseStatus: "declined" }] }),
          timed("declined", "2026-10-27T09:00:00Z", { attendees: [{ email: "me", self: true, responseStatus: "declined" }] }),
          timed("cancelled", "2026-10-27T09:00:00Z", { status: "cancelled" }),
        ],
      },
    });
    expect((await listEvents(RANGE, impl)).map((e) => e.title)).toEqual(["kept"]);
  });

  it("follows nextPageToken for calendars and events", async () => {
    const { impl, calls } = fakeGoogle({
      "/calendar/v3/users/me/calendarList": (u: URL) =>
        u.searchParams.get("pageToken") ? { items: [{ id: "b", summary: "B", backgroundColor: "#222222" }] } : { items: [{ id: "a", summary: "A", backgroundColor: "#111111" }], nextPageToken: "cl2" },
      "/calendar/v3/colors": COLORS,
      "/calendar/v3/calendars/a/events": (u: URL) =>
        u.searchParams.get("pageToken") === "p2" ? { items: [timed("a2", "2026-10-28T09:00:00Z")] } : { items: [timed("a1", "2026-10-27T09:00:00Z")], nextPageToken: "p2" },
      "/calendar/v3/calendars/b/events": { items: [timed("b1", "2026-10-29T09:00:00Z")] },
    });
    expect((await listEvents(RANGE, impl)).map((e) => e.title)).toEqual(["a1", "a2", "b1"]);
    expect(calls.filter((u) => u.pathname.endsWith("/a/events")).map((u) => u.searchParams.get("pageToken"))).toEqual([null, "p2"]);
  });

  it("surfaces API errors", async () => {
    const { impl } = fakeGoogle({ "/calendar/v3/colors": COLORS });
    await expect(listEvents(RANGE, impl)).rejects.toThrow(/Google Calendar: no route/);
  });
});

describe("Google Calendar adapter", () => {
  it("is available only with both env vars, and writes nothing", async () => {
    expect(googleConfigured({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" })).toBe(true);
    expect(googleConfigured({ GOOGLE_CLIENT_ID: "a" })).toBe(false);
    expect(googleCalendarAdapter.label).toBe("Google Calendar");
    expect(googleCalendarAdapter.fallback).toEqual({ label: "Open Google Calendar", href: "https://calendar.google.com" });
    expect(await googleCalendarAdapter.sync({}, "rt", fetch)).toBeNull();
    expect(googleCalendarAdapter.mapToEvents(null, { today: "2026-10-27", config: {} })).toEqual([]);
  });
});
