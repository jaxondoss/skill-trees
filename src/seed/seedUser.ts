import type { SupabaseClient } from "@supabase/supabase-js";
import { startingTemplate } from "./starting";

/**
 * Seeds the signed-in user's starting content in one transaction (public.seed_user): every skill with
 * an empty to-do list (spec v2 r2, 7). Safe to call repeatedly: returns false if already seeded.
 */
export async function seedUserFromTemplate(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("seed_user", { p_template: startingTemplate() });
  if (error) throw new Error(`Seeding failed: ${error.message}`);
  return data === true;
}
