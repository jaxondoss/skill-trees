# Google Calendar on the calendar wall

The calendar wall in the room shows the owner's Google Calendar: every calendar shown in Google
Calendar, each event in the colour Google gives it. Adding an event opens Google Calendar itself, so
FORGE only ever asks for read access (`https://www.googleapis.com/auth/calendar.readonly`). Events
are read live and never stored in FORGE's tables. Only the refresh token is stored, encrypted with
`INTEGRATIONS_KEY` (AES-256-GCM) in `integrations.secret_ciphertext`.

## Setup (owner, once)

1. **Google Cloud project.** Open https://console.cloud.google.com, create a project (for example
   "FORGE"), then APIs and Services, Library, search "Google Calendar API", Enable.
2. **OAuth consent screen** (Google Auth Platform, Branding / Audience / Data access):
   - User type: External. App name "FORGE", your email as support and developer contact.
   - Audience: leave the publishing status as **Testing** and add your own Google account under
     **Test users**. Only test users can sign in, which is what we want for a single-user app.
     (In Testing mode Google expires refresh tokens after 7 days; if the wall starts saying access
     expired, reconnect from Settings, or publish the app to "In production" to stop the expiry.
     The read-only calendar scope is "sensitive", so a production app shows an "unverified app"
     warning you can click through for your own account.)
   - Data access: add the scope `https://www.googleapis.com/auth/calendar.readonly`.
3. **OAuth client.** Clients, Create client, Application type **Web application**, name "FORGE web".
   Authorised redirect URIs, add both:
   - `https://<your production domain>/api/google/callback`
   - `http://localhost:3000/api/google/callback`
   Add any preview domain you want to connect from too; the redirect must match the origin the
   connect link was opened on exactly. Save, then copy the client ID and client secret.
4. **Vercel env vars** (Project, Settings, Environment Variables, Production and Preview):
   - `GOOGLE_CLIENT_ID` = the client ID
   - `GOOGLE_CLIENT_SECRET` = the client secret
   - `INTEGRATIONS_KEY` = 32 random bytes, base64 (already set if Strava/Canvas use it;
     otherwise `openssl rand -base64 32`). Changing it later invalidates the stored token; just reconnect.
   Redeploy. For local dev put the same three in `.env.local`.
5. **Connect.** Settings, Integrations, Google Calendar, "Connect Google Calendar". Approve on
   Google's screen; you land back on Settings with "Google Calendar is connected."
   "Disconnect" deletes the stored token. To revoke on Google's side too, remove FORGE at
   https://myaccount.google.com/permissions.

If Google returns no refresh token (it only sends one on a fresh consent), remove FORGE at
myaccount.google.com/permissions and connect again; the connect link always asks with
`prompt=consent` and `access_type=offline`.

## How it works

- `GET /api/google/connect` (signed-in only): makes a random state, stores it in an httpOnly,
  secure, sameSite=lax cookie scoped to `/api/google` for 10 minutes, and redirects to Google with
  `redirect_uri = <request origin>/api/google/callback`.
- `GET /api/google/callback`: checks the state against the cookie, exchanges the code, upserts the
  `integrations` row (`provider 'google_calendar'`, `status 'connected'`, `config {connectedAt}`,
  `secret_ciphertext` = encrypted refresh token), clears the cookie, and redirects to
  `/settings?connected=google_calendar` or `/settings?error=<code>`. Error codes: `google_state`,
  `google_denied`, `google_failed`, `google_no_refresh_token`, `google_not_configured`,
  `integrations_key`, `google_save_failed`, `sign_in`.
- `loadCalendarEvents` (server only) reads the row, decrypts the refresh token, gets an access token
  (cached in memory until a minute before expiry), and lists events (cached 2 minutes per user and
  range). Success sets `last_synced_at` and clears `last_error`; failure sets `status 'error'` and
  `last_error`, which Settings shows.

## Data contract

```ts
// src/lib/data/googleCalendar.ts (server only, never throws)
loadCalendarEvents(
  supabase: SupabaseClient,
  range: { timeMin: string; timeMax: string; timeZone?: string }, // RFC 3339; IANA zone, e.g. "America/Chicago"
): Promise<{ connected: boolean; events: CalendarEvent[]; error?: string }>
// GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing -> { connected: false, events: [], error: "not configured" }
// no stored connection                              -> { connected: false, events: [] }
// connected but Google failed                       -> { connected: true, events: [], error }

// src/integrations/googleCalendar.ts
type CalendarEvent = {
  id: string;          // "<calendarId>:<eventId>", unique across calendars (safe as a React key)
  calendarId: string;
  calendar: string;    // the calendar's summaryOverride, else its summary
  title: string;       // summary, else "(No title)"
  start: string;       // timed: RFC 3339 date-time as Google sends it; all-day: "YYYY-MM-DD"
  end: string;         // same format; all-day end is exclusive, as in Google (a one-day event ends the next day)
  allDay: boolean;
  color: string;       // "#rrggbb", lowercase
  htmlLink?: string;   // opens the event in Google Calendar
};
```

Events come back sorted by start. Which events and colours, matching what Google Calendar shows:

- Calendars: every `calendarList` entry except `hidden: true` and `selected: false` (absent
  `selected` counts as shown).
- Events: `singleEvents=true` (recurring events expanded), `orderBy=startTime`, `showDeleted=false`,
  all pages. Cancelled events and events the owner declined (an attendee with `self: true` and
  `responseStatus: "declined"`) are skipped.
- Colour: the event's `colorId` from `/colors` `event` palette; otherwise the calendar's
  `backgroundColor`; otherwise the calendar's `colorId` from the `calendar` palette.

The wall's "add event" button links to https://calendar.google.com (the adapter's fallback).
