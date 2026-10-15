/** Shared engine types. Engines are pure: plain data in, plain data out, "now" always passed in. */

/** Calendar day in the user's time zone after the rollover shift: "YYYY-MM-DD". */
export type DayKey = string;

export type Tier = "floor" | "standard" | "stretch";
export type DayType = "class_light" | "class_heavy" | "weekend" | "break";
export type OverrideKind = "exam_week" | "race_week" | "sick" | "travel";
export type SkillStatus = "active" | "dormant" | "archived";
export type GoalKind = "rack" | "balance" | "stretch";

/** One planned goal's outcome on a past or current day. A null result means not done. */
export type GoalRecord = {
  day: DayKey;
  skillId: string;
  nonNegotiableId: string | null;
  kind: GoalKind;
  plannedTier: Tier;
  result: Tier | null;
};

export type MilestoneRule = { key: string; op: "gte" | "lte"; value: number };

export type EngineMilestone = {
  id: string;
  points: number;
  claimed: boolean;
  rule?: MilestoneRule | null;
};

export type EngineNonNegotiable = {
  id: string;
  skillId: string;
  name: string;
  text: Record<Tier, string>;
  minutes: Record<Tier, number>;
  countsAgainstBudget: boolean;
  intention: string;
  /** 0 = Sunday ... 6 = Saturday */
  daysOfWeek: number[];
  /** Null means every day type. */
  dayTypes: DayType[] | null;
  defaultTier: Tier;
};

export type EngineCategory = {
  id: string;
  slug: string;
  name: string;
  /** Goal engine weight: 1.3 Business and Athletics, 1.2 Mind, 1.0 otherwise. */
  goalWeight: number;
};

export type EngineSkill = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  status: SkillStatus;
  priorityWeight: number;
  /** Current skill score S (0 to 100). */
  score: number;
  nonNegotiables: EngineNonNegotiable[];
};
