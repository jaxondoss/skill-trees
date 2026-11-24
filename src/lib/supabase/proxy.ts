import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { LOGIN_PATH, safeNext } from "@/lib/auth/next";
import { supabasePublicEnv } from "./env";

/** Pages that render without a session: the login screen. */
const OPEN_PATHS = [LOGIN_PATH];
/** Old entry points (magic link, walkthrough). They now go to the dashboard, or the login screen when signed out. */
const RETIRED_PATHS = ["/onboarding", "/auth", "/setup"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Refreshes the session cookie. With no session, pages go to the login screen and API routes answer 401.
 * Nobody is signed in automatically: every visitor has to log in with a Supabase account.
 */
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
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    const next = path === "/" ? "" : `${path}${request.nextUrl.search}`;
    return redirectKeepingCookies(request, response, LOGIN_PATH, next ? { next } : {});
  }
  if (signedIn && matches(path, OPEN_PATHS)) {
    const to = new URL(safeNext(request.nextUrl.searchParams.get("next")), request.nextUrl.origin);
    return redirectKeepingCookies(request, response, to.pathname, Object.fromEntries(to.searchParams));
  }

  if (matches(path, RETIRED_PATHS)) return redirectKeepingCookies(request, response, "/");
  // The admin view exists only for ADMIN_EMAILS: everyone else gets the app's 404 (with a real 404 status; the
  // page checks again under its Suspense boundary, where a 404 can no longer change the status).
  if (matches(path, ["/admin"])) {
    const email = data?.claims?.email;
    if (!isAdmin({ email: typeof email === "string" ? email : null })) {
      const url = request.nextUrl.clone();
      url.pathname = "/_not-found-admin";
      const res = NextResponse.rewrite(url, { status: 404 });
      response.cookies.getAll().forEach((c) => res.cookies.set(c));
      return res;
    }
  }
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
