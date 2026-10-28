import { NextResponse, type NextRequest } from "next/server";
import { loadProfile, todayFor } from "@/lib/data/context";
import { isMonth, loadWallMonth } from "@/lib/data/calendarWall";
import { createClient } from "@/lib/supabase/server";

/** GET /api/calendar?month=YYYY-MM: one month of the room's calendar wall (FORGE days and Google events). */
export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!isMonth(month)) return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const profile = await loadProfile(supabase);
  const today = todayFor(profile, new Date());
  // today's live completion comes with the room's own data; past months only need the cached days
  const m = await loadWallMonth(supabase, month, { today, todayP: null, timeZone: profile.timezone });
  return NextResponse.json({ days: m.days, events: m.events, connected: m.connected });
}
