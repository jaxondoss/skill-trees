import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { encryptSecret, parseKey } from "@/integrations/crypto";
import { exchangeCode, GOOGLE_STATE_COOKIE } from "@/integrations/googleCalendar";
import { createClient } from "@/lib/supabase/server";

const sameState = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Google sends the owner back here. Stores the refresh token encrypted; the token never reaches the browser. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const done = (query: string) => {
    const res = NextResponse.redirect(new URL(`/settings?${query}`, origin));
    res.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/api/google" });
    res.headers.set("cache-control", "no-store");
    return res;
  };

  const expected = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const state = params.get("state");
  if (!expected || !state || !sameState(state, expected)) return done("error=google_state");
  if (params.get("error")) return done(params.get("error") === "access_denied" ? "error=google_denied" : "error=google_failed");
  const code = params.get("code");
  if (!code) return done("error=google_failed");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return done("error=google_not_configured");
  let key: Buffer;
  try {
    key = parseKey(process.env.INTEGRATIONS_KEY);
  } catch {
    return done("error=integrations_key");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!uid) return done("error=sign_in");

  let refreshToken: string;
  try {
    ({ refreshToken } = await exchangeCode({ code, clientId, clientSecret, redirectUri: `${origin}/api/google/callback` }, fetch));
  } catch (err) {
    return done(err instanceof Error && /no refresh token/.test(err.message) ? "error=google_no_refresh_token" : "error=google_failed");
  }

  const { error } = await supabase.from("integrations").upsert(
    {
      user_id: uid,
      provider: "google_calendar",
      status: "connected",
      config: { connectedAt: new Date().toISOString() },
      secret_ciphertext: encryptSecret(refreshToken, key),
      last_error: null,
    },
    { onConflict: "user_id,provider" },
  );
  if (error) return done("error=google_save_failed");
  return done("connected=google_calendar");
}
