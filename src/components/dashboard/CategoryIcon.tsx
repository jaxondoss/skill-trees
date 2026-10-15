import { BookOpen, Brain, Briefcase, Circle, Dumbbell, Leaf, type LucideProps } from "lucide-react";

const ICONS = { briefcase: Briefcase, book: BookOpen, brain: Brain, dumbbell: Dumbbell, leaf: Leaf };

export function CategoryIcon({ icon, ...props }: { icon: string | null } & LucideProps) {
  const Icon = ICONS[(icon ?? "") as keyof typeof ICONS] ?? Circle;
  return <Icon aria-hidden {...props} />;
}
