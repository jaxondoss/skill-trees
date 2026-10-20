# Next steps (after the redesign build, 2026-10-17)

The redesign is live on main: the board, the field, skill pages with goal and step to-do lists, a
visualization for every skill, empty starting lists for new accounts, and the journal. All checks pass
(lint, typecheck, 162 unit tests, DB tests, 49 e2e tests on a production build).

## For Jaxon
- Connections (2026-10-20): open Settings. "Connection check" shows which keys Vercel has. Tap Test Gemini,
  then Connect Lyfta (pick lb or kg to match Lyfta). Strava is built later, once its keys are in.
0. No more magic link: the app signs you in on its own. Once: in Supabase > Authentication > Users, add a
   user with your email and a password (Auto confirm). In Vercel > Environment Variables, add
   FORGE_OWNER_EMAIL and FORGE_OWNER_PASSWORD, then redeploy. Also set the Supabase Site URL to
   `https://skill-trees-seven.vercel.app` (it was missing `https://`, which caused "requested path is invalid").
1. Open the app and look at the board on the laptop and the phone. Note anything that feels off.
2. Decide on your own lists: Settings > Starting content > "Start with empty lists" clears the starter
   goals and open steps (claimed steps stay). Then fill in each skill's to-do list; empty lists offer
   starter ideas.
3. Confirm migration 0009 ran on Supabase (Table Editor shows `journal_entries`, and `milestones` has a
   `note` column). If the dashboard errors on Journal, run the migration.
4. Add the half marathon date in Settings > Key dates (kind Race) so Running draws the build to race day.
5. Set your class times and training slots in Settings so Next up fills in.
6. Try Settings > Look and feel: Background Live, Calm or Still; Power-up Comic or Calm.
7. Still open from before: ANTHROPIC_API_KEY and INTEGRATIONS_KEY in Vercel env vars (never in chat),
   the Canvas URL and OK to use its public docs, Google OAuth.

## Build follow-ups (not done yet)
- Minutes slider on timed goals in Today (needs a `progress_value` on plan goals).
- Rename a goal for today only from Today (the skill page edits apply from tomorrow's plan).
- Restyle the tier-up and streak-break moments to the new type and lighting.
- Habit names for Gut Health and product cost share for Dropshipping are editable only in skill config;
  surface them on the skill page.
- "100 means" is not editable in the app; new accounts start without it.
- A per-skill viz for time blocking with real calendar blocks once Google Calendar is connected.
