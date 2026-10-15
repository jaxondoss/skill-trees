/** Shapes of the starting content every new user is seeded with. */

export type Tier = "floor" | "standard" | "stretch";
export type DayType = "class_light" | "class_heavy" | "weekend" | "break";
export type SkillStatus = "active" | "dormant" | "archived";
export type MilestoneType = "manual" | "metric" | "streak" | "count";
export type FigureRegion = "head" | "left_arm" | "right_arm" | "left_leg_core" | "right_leg_chest";
export type DashboardPosition = "top_left" | "top_right" | "top_center" | "bottom_left" | "bottom_right";

/** 0 = Sunday ... 6 = Saturday */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Machine-checkable auto-claim rule: claim when value(key) op threshold.
 * Keys are metric names (bench_1rm) or derived counters (books_finished).
 * Null rule means the user claims it by hand.
 */
export type MilestoneRule = { key: string; op: "gte" | "lte"; value: number };

export type MilestoneTemplate = {
  title: string;
  points: number;
  type: MilestoneType;
  rule?: MilestoneRule;
  /** Prefilled as claimed at onboarding (the spec's check marks), pending confirmation. */
  suggestClaim?: boolean;
};

export type NonNegotiableTemplate = {
  name: string;
  floor: string;
  standard: string;
  stretch: string;
  minutes: Record<Tier, number>;
  /** Training sessions and zero-minute habits do not count against the daily budget. */
  countsAgainstBudget: boolean;
  intention: string;
  daysOfWeek: Weekday[];
  /** Day types this goal is scheduled on. Omitted means every type. */
  dayTypes?: DayType[];
  defaultTier: Tier;
};

export type SkillTemplate = {
  slug: string;
  name: string;
  priorityWeight: 1 | 2 | 3;
  status: SkillStatus;
  identity: string;
  hundredMeans: string;
  metricsNote?: string;
  /** Skill-specific settings (sleep anchor, food targets, run plan). */
  config?: Record<string, unknown>;
  milestones: MilestoneTemplate[];
  nonNegotiables: NonNegotiableTemplate[];
  tips: { foundation: string[]; development: string[]; mastery: string[] };
};

export type CategoryTemplate = {
  slug: string;
  name: string;
  color: string;
  icon: string;
  region: FigureRegion;
  position: DashboardPosition;
  /** Goal engine weight (spec 7.2). Never affects the overall score. */
  goalWeight: number;
  skills: SkillTemplate[];
};

export type ScheduleDayTemplate = {
  weekday: Weekday;
  dayType: DayType;
  classes: { course: string; start: string; end: string; confirm?: boolean }[];
  trainingTime: string | null;
  notes?: string;
};

export type KeyDateTemplate = {
  kind: "race" | "exam" | "other";
  label: string;
  date: string | null;
  tentative: boolean;
  skillSlug?: string;
  goal?: string;
};

export type SeedTemplate = {
  version: number;
  profile: { timezone: string; rolloverHour: number; dailyBudgetMin: number };
  categories: CategoryTemplate[];
  schedule: { name: string; startsOn: string; endsOn: string; days: ScheduleDayTemplate[] };
  keyDates: KeyDateTemplate[];
  rack: string[];
};
