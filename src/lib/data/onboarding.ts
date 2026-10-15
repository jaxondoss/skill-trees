import "server-only";
import { connection } from "next/server";
import type { DayType } from "@/engine/types";
import { createClient } from "@/lib/supabase/server";
import { must } from "./context";

export type OnboardingData = {
  schedule: { weekday: number; dayType: DayType; trainingTime: string | null; classes: { course: string; start: string; end: string; confirm?: boolean }[]; notes: string | null }[];
  suggested: { id: string; title: string; points: number; skillName: string; color: string }[];
  skills: { id: string; slug: string; name: string; color: string; categoryName: string }[];
  rack: string[];
  baselines: { skillId: string; key: string; label: string; unit: string; value: number | null }[];
  chess: { platform: "chess.com" | "lichess" | null; username: string };
};

export async function isOnboarded(): Promise<boolean> {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("onboarded_at").maybeSingle();
  return Boolean((data as { onboarded_at: string | null } | null)?.onboarded_at);
}

/** Prefilled first-run choices (spec 4.6), every one editable. */
export async function loadOnboarding(): Promise<OnboardingData> {
  await connection();
  const supabase = await createClient();
  const [days, ms, skills, cats, pins] = await Promise.all([
    supabase.from("schedule_days").select("weekday, day_type, training_time, classes, notes, schedule_templates!inner(is_active)").eq("schedule_templates.is_active", true),
    supabase.from("milestones").select("id, title, points, skill_id, suggest_claim, claimed_at").eq("suggest_claim", true),
    supabase.from("skills").select("id, slug, name, category_id, status, config, sort").order("sort"),
    supabase.from("categories").select("id, name, color, sort").order("sort"),
    supabase.from("rack_pins").select("slot, skill_id").order("slot"),
  ]);
  type S = { id: string; slug: string; name: string; category_id: string; status: string; config: Record<string, unknown> };
  const skillRows = must(skills, "skills") as S[];
  const catRows = must(cats, "categories") as { id: string; name: string; color: string }[];
  const cat = new Map(catRows.map((c) => [c.id, c]));
  const bySlug = new Map(skillRows.map((s) => [s.slug, s]));
  const strength = (bySlug.get("strength")?.config?.current ?? {}) as { bench?: number; squat?: number; bodyweight?: number };
  const chessConfig = (bySlug.get("chess")?.config ?? {}) as { platform?: "chess.com" | "lichess" | null; username?: string | null };

  const baseline = (slug: string, key: string, label: string, unit: string, value: number | null) => {
    const s = bySlug.get(slug);
    return s ? [{ skillId: s.id, key, label, unit, value }] : [];
  };

  const order = new Map(catRows.map((c, i) => [c.id, i]));
  return {
    schedule: ((must(days, "schedule") ?? []) as { weekday: number; day_type: DayType; training_time: string | null; classes: OnboardingData["schedule"][number]["classes"]; notes: string | null }[])
      .map((d) => ({ weekday: d.weekday, dayType: d.day_type, trainingTime: d.training_time?.slice(0, 5) ?? null, classes: d.classes ?? [], notes: d.notes }))
      .sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7)),
    suggested: ((must(ms, "milestones") ?? []) as { id: string; title: string; points: number; skill_id: string }[]).map((m) => {
      const s = skillRows.find((x) => x.id === m.skill_id);
      return { id: m.id, title: m.title, points: m.points, skillName: s?.name ?? "", color: cat.get(s?.category_id ?? "")?.color ?? "#8E8A84" };
    }),
    skills: skillRows
      .filter((s) => s.status === "active")
      .sort((a, b) => (order.get(a.category_id) ?? 0) - (order.get(b.category_id) ?? 0))
      .map((s) => ({ id: s.id, slug: s.slug, name: s.name, color: cat.get(s.category_id)?.color ?? "#8E8A84", categoryName: cat.get(s.category_id)?.name ?? "" })),
    rack: ((pins.data ?? []) as { skill_id: string }[]).map((p) => p.skill_id),
    baselines: [
      ...baseline("strength", "bench_1rm", "Bench", "lb", strength.bench ?? null),
      ...baseline("strength", "squat_1rm", "Squat", "lb", strength.squat ?? null),
      ...baseline("strength", "bodyweight_lb", "Bodyweight", "lb", strength.bodyweight ?? null),
      ...baseline("running", "long_run_mi", "Longest recent run", "mi", 4),
      ...baseline("chess", "chess_rating", "Chess rating", "", 1000),
    ],
    chess: { platform: chessConfig.platform ?? null, username: chessConfig.username ?? "" },
  };
}
