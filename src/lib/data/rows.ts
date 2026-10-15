/** Row shapes for the columns the app selects. Kept by hand until generated types are wired up. */
import type { DayType, OverrideKind, SkillStatus, Tier } from "@/engine/types";

export type ProfileRow = {
  timezone: string;
  rollover_hour: number;
  daily_budget_min: number;
  focus_line: string | null;
};

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  color: string;
  icon: string | null;
  region: string;
  position: string;
  goal_weight: number;
  sort: number;
};

export type SkillRow = {
  id: string;
  slug: string;
  name: string;
  category_id: string;
  status: SkillStatus;
  priority_weight: number;
  sort: number;
  created_at: string;
  final_score: number | null;
};

export type MilestoneRow = { skill_id: string; points: number; claimed_at: string | null };

export type NonNegotiableRow = {
  id: string;
  skill_id: string;
  name: string;
  floor_text: string;
  standard_text: string;
  stretch_text: string;
  floor_min: number;
  standard_min: number;
  stretch_min: number;
  counts_against_budget: boolean;
  intention: string;
  days_of_week: number[];
  day_types: DayType[] | null;
  default_tier: Tier;
  sort: number;
};

export type RackPinRow = { slot: number; skill_id: string; locked_until: string };

export type ScheduleDayRow = { weekday: number; day_type: DayType };

export type DayOverrideRow = { kind: OverrideKind; starts_on: string; ends_on: string };

export type KeyDateRow = { label: string; date: string | null };

export type PlanGoalRow = {
  id: string;
  skill_id: string;
  non_negotiable_id: string | null;
  kind: "rack" | "balance" | "stretch";
  tier: Tier;
  title: string;
  text: string;
  est_min: number;
  reason: string | null;
  engine_note: string | null;
  sort: number;
  result_tier: Tier | null;
  daily_plans: { day: string };
};

export type CompletionRow = { day: string; p: number; n_core: number; kept_streak: boolean };

export type SnapshotRow = { scope: "skill" | "category" | "overall"; ref_id: string | null; score: number };
