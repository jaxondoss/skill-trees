import "server-only";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * There is no first-run walkthrough: the app opens straight to the dashboard. A profile that was never
 * marked onboarded is marked now, before the first plan, with the seeded rack and schedule as they are.
 * Every choice the walkthrough made stays editable in Settings and on the skill pages.
 */
export async function ensureOnboarded(): Promise<void> {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("user_id, onboarded_at").maybeSingle();
  const row = data as { user_id: string; onboarded_at: string | null } | null;
  if (row && !row.onboarded_at) {
    await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("user_id", row.user_id).is("onboarded_at", null);
  }
}
