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

export const liftaAdapter = pending({
  id: "lifta",
  label: "Lifta",
  feeds: "Strength: sessions complete the goal, top sets update bench and squat.",
  fallback: { label: "Enter top sets on the Strength page", href: "/s/strength" },
  needs: ["Lifta's API documentation", "a Lifta API key"],
});

export const claudeAdapter = pending({
  id: "claude",
  label: "Claude (Anthropic API)",
  feeds: "Food: meal photo to nutrition table with portions confirmed. Weekly review debrief and reading tests.",
  fallback: { label: "Quick-add meals on the Food page", href: "/s/food" },
  needs: ["an Anthropic API key, set as the ANTHROPIC_API_KEY server env var in Vercel"],
});
