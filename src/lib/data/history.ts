import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Daily snapshot series for charts: overall (no ref) or one category or skill. */
export async function loadHistory(scope: "overall" | "category" | "skill", refId?: string): Promise<{ day: string; score: number }[]> {
  const supabase = await createClient();
  let q = supabase.from("score_snapshots").select("day, score").eq("scope", scope);
  q = refId ? q.eq("ref_id", refId) : q.is("ref_id", null);
  const { data } = await q.order("day").limit(1000);
  return ((data ?? []) as { day: string; score: number }[]).map((r) => ({ day: r.day, score: Number(r.score) }));
}
