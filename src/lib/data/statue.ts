import "server-only";
import { initialLevel } from "@/engine/statue";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The stored statue level, set to the score's whole part on the first read (so the level does not ride the score
 * up on its own). Before migration 0012 the column is missing: the level is then the score's whole part, unsaved.
 */
export async function loadStatueLevel(supabase: Supabase, score: number): Promise<{ level: number; stored: boolean }> {
  const { data, error } = await supabase.from("profiles").select("user_id, statue_level").single();
  if (error || !data) return { level: initialLevel(score), stored: false };
  const row = data as { user_id: string; statue_level: number | null };
  if (row.statue_level !== null) return { level: row.statue_level, stored: true };
  const level = initialLevel(score);
  const { error: upd } = await supabase.from("profiles").update({ statue_level: level }).eq("user_id", row.user_id).is("statue_level", null);
  return { level, stored: !upd };
}
