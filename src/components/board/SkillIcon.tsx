import {
  Activity,
  BedDouble,
  Bike,
  BookOpen,
  Brain,
  Briefcase,
  CalendarClock,
  Cpu,
  Crown,
  Dumbbell,
  Eye,
  GraduationCap,
  Infinity as InfinityIcon,
  Leaf,
  ShoppingBag,
  Sprout,
  Target,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/** One icon per skill, chosen once and reused everywhere it appears (design guidelines, iconography). */
const ICONS: Record<string, LucideIcon> = {
  business: Briefcase,
  school: GraduationCap,
  athletics: Dumbbell,
  mind: Brain,
  nutrition: Leaf,
  "ai-building": Cpu,
  dropshipping: ShoppingBag,
  academics: GraduationCap,
  reading: BookOpen,
  "college-integration": Users,
  "time-blocking": CalendarClock,
  chess: Crown,
  meditation: InfinityIcon,
  visualization: Eye,
  strength: Dumbbell,
  running: Activity,
  sleep: BedDouble,
  triathlon: Bike,
  food: UtensilsCrossed,
  "gut-health": Sprout,
};

export function SkillIcon({ slug, size = 18 }: { slug: string; size?: number }) {
  const Icon = ICONS[slug] ?? Target;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}
