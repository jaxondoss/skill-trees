import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authUrl, GOOGLE_STATE_COOKIE } from "@/integrations/googleCalendar";
import { createClient } from "@/lib/supabase/server";

/** Starts the Google sign-in: a random state goes in a short-lived cookie, then off to Google's consent screen. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const back = (error: string) => NextResponse.redirect(new URL(`/settings?error=${error}`, origin));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return back("google_not_configured");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return back("sign_in");

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl({ clientId, redirectUri: `${origin}/api/google/callback`, state }));
  res.cookies.set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google" });
  res.headers.set("cache-control", "no-store");
  return res;
}
