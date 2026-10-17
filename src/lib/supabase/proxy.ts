import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { seedUserFromTemplate } from "@/seed/seedUser";
import { supabasePublicEnv } from "./env";

/** Pages that render without a session: the setup notice shown when the owner sign-in is not configured. */
const OPEN_PATHS = ["/setup"];
/** Old entry points (magic link, walkthrough). The app now opens straight to the dashboard. */
const RETIRED_PATHS = ["/login", "/onboarding", "/auth"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * FORGE has one user, so there is no sign-in screen: when there is no session, the server signs in the
 * owner account with FORGE_OWNER_EMAIL and FORGE_OWNER_PASSWORD (server-only env vars, never sent to
 * the browser) and sets the session cookie. Row level security still scopes every row to that account.
 */
async function signInOwner(supabase: SupabaseClient): Promise<"ok" | "missing" | "failed"> {
  const email = process.env.FORGE_OWNER_EMAIL;
  const password = process.env.FORGE_OWNER_PASSWORD;
  if (!email || !password) return "missing";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`Owner sign-in failed: ${error.message}`);
    return "failed";
  }
  try {
    await seedUserFromTemplate(supabase);
  } catch (e) {
    console.error(e);
  }
  return "ok";
}

/** Refreshes the session cookie, signing the owner in when there is none. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = supabasePublicEnv();
  // Not configured yet: let the shell render its setup notice.
  if (!env) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Do not run code between createServerClient and getClaims: it validates
  // the JWT and refreshes the session if needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && !matches(path, OPEN_PATHS)) {
    const result = await signInOwner(supabase);
    if (result !== "ok") return redirectKeepingCookies(request, response, "/setup", { reason: result });
  }

  if (matches(path, RETIRED_PATHS)) return redirectKeepingCookies(request, response, "/");
  return response;
}

/** A redirect that still carries any session cookie set on `from`. */
function redirectKeepingCookies(request: NextRequest, from: NextResponse, pathname: string, search: Record<string, string> = {}) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = new URLSearchParams(search).toString();
  const res = NextResponse.redirect(url);
  from.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}
