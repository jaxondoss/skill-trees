import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabasePublicEnv } from "./env";

/**
 * Next memoizes identical GET fetches within a render, which would let a read that follows a
 * write in the same render (save today's plan, then load it) return the stale first response.
 * A per-call AbortController signal opts out, as the Next.js fetch docs describe.
 */
const freshFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? new AbortController().signal });

/** Request-scoped client. Create a new one per request; never share it. */
export async function createClient() {
  const { url, key } = requireSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    global: { fetch: freshFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
