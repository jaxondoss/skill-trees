import type { IntegrationAdapter } from "./types";

/**
 * Integrations that need something from the user before they can be built (spec 0.4: never invent
 * endpoints). Each states exactly what is missing and where the manual fallback lives.
 */
function pending(a: Pick<IntegrationAdapter, "id" | "label" | "feeds" | "fallback" | "needs">): IntegrationAdapter {
  const notReady = () => {
    throw new Error(`${a.label} is not built yet. Needs: ${a.needs.join("; ")}.`);
  };
  return { ...a, available: false, connect: notReady, sync: async () => notReady(), mapToEvents: () => [] };
}

export const canvasAdapter = pending({
  id: "canvas",
  label: "Canvas",
  feeds: "Academics: assignments, due dates, submissions, and grades. Powers the 48-hour rule.",
  fallback: { label: "Add assignments on the Academics page", href: "/s/academics" },
  needs: ["Tulane's Canvas base URL", "a Canvas personal access token (Account, Settings, New access token), or the calendar feed URL if tokens are disabled"],
});

export const googleCalendarAdapter = pending({
  id: "google_calendar",
  label: "Google Calendar",
  feeds: "Time Blocking: checks that tomorrow is planned (at least 5 blocks).",
  fallback: { label: "Rate block adherence on the Time Blocking page", href: "/s/time-blocking" },
  needs: ["a Google Cloud OAuth client (client ID and secret) with the calendar read scope", "the app's redirect URL added to that client"],
});

export const stravaAdapter = pending({
  id: "strava",
  label: "Strava",
  feeds: "Running: runs complete the goal and fill run and long run distance.",
  fallback: { label: "Log runs on the Running page", href: "/s/running" },
  needs: ["a Strava API app (strava.com/settings/api) with its client ID and secret as STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in Vercel"],
});
