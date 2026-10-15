import type { SupabaseClient } from "@supabase/supabase-js";
import { SEED_TEMPLATE } from "./template";

/**
 * Seeds the signed-in user's starting content in one transaction
 * (public.seed_user). Safe to call repeatedly: returns false if already seeded.
 */
export async function seedUserFromTemplate(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("seed_user", { p_template: SEED_TEMPLATE });
  if (error) throw new Error(`Seeding failed: ${error.message}`);
  return data === true;
}
