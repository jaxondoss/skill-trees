import { MonthlyReview } from "@/components/review/MonthlyReview";
import { WeeklyReview } from "@/components/review/WeeklyReview";
import { loadMonthlyReview, loadWeeklyReview } from "@/lib/data/reviews";

/** The weekly review, loaded. Rendered by /review and the admin view. */
export async function WeeklyReviewDashboard() {
  return <WeeklyReview data={await loadWeeklyReview()} />;
}

/** The monthly review, loaded. Rendered by /review/month and the admin view. */
export async function MonthlyReviewDashboard() {
  return <MonthlyReview data={await loadMonthlyReview()} />;
}
