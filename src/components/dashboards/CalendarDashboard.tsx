import { TrendTile } from "@/components/board/TrendTile";
import { CompletionCalendar } from "@/components/calendar/CompletionCalendar";
import { loadBoard } from "@/lib/data/board";

/** The board's Record row (completion calendar and trend), on its own. Rendered by the admin view's calendar tile. */
export async function CalendarDashboard() {
  const data = await loadBoard();
  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 md:col-span-6 [&>section]:h-full">
        <CompletionCalendar days={data.calendar} today={data.today} />
      </div>
      <div className="col-span-12 md:col-span-6 [&>section]:h-full">
        <TrendTile trend={data.trend} completion={data.calendar} />
      </div>
    </div>
  );
}
