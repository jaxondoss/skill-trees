import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicEnv } from "./env";

export function createClient() {
  const { url, key } = requireSupabasePublicEnv();
  return createBrowserClient(url, key);
}
