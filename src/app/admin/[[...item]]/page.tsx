import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AdminArchive, AdminRelics, AdminSkillActions } from "@/components/admin/AdminActions";
import { RoomDebug } from "@/components/admin/RoomDebug";
import { BoardDashboard, BoardSkeleton } from "@/components/dashboards/BoardDashboard";
import { CalendarDashboard } from "@/components/dashboards/CalendarDashboard";
import { CategoryDashboard } from "@/components/dashboards/CategoryDashboard";
import { OverallDashboard } from "@/components/dashboards/OverallDashboard";
import { MonthlyReviewDashboard, WeeklyReviewDashboard } from "@/components/dashboards/ReviewDashboards";
import { SettingsDashboard } from "@/components/dashboards/SettingsDashboard";
import { SkillDashboard } from "@/components/dashboards/SkillDashboard";
import { isTileId, itemFromSegments } from "@/lib/admin-items";
import { loadAdminData, type AdminData } from "@/lib/data/admin";

export const metadata: Metadata = { title: "FORGE · Admin", robots: { index: false, follow: false } };

/**
 * /admin/<item>: the expanded tile's content, shown by the admin layout's AdminView in its panel (the plan and tiles
 * live in the layout, so they stay mounted while tiles open and close). /admin itself renders nothing here.
 * Items: s/<skill slug>, overall, categories, board, calendar, review, review/month, relics, archive, settings, debug.
 */
export default function AdminItemPage({ params }: PageProps<"/admin/[[...item]]">) {
  return (
    <Suspense fallback={<p className="adm-loading">Loading.</p>}>
      <Panel params={params} />
    </Suspense>
  );
}

async function Panel({ params }: { params: PageProps<"/admin/[[...item]]">["params"] }) {
  const [{ item: segments }, data] = await Promise.all([params, loadAdminData()]);
  if (!data) notFound();
  const item = itemFromSegments(segments);
  if (!item) return null;
  if (!isTileId(item, data.skills.map((s) => s.slug))) notFound();
  return <Dashboard item={item} data={data} />;
}

/** The expanded tile's content: the shared dashboard (one implementation with its page) plus the ADMIN section. */
function Dashboard({ item, data }: { item: string; data: AdminData }): ReactNode {
  const dash = (node: ReactNode) => <div className="adm-dash">{node}</div>;
  if (item.startsWith("s/")) {
    const skill = data.skills.find((s) => s.slug === item.slice(2))!;
    return (
      <div className="adm-split">
        {dash(<SkillDashboard slug={skill.slug} embedded />)}
        <div className="adm-aside">
          <AdminSkillActions skill={skill} categories={data.categories} />
        </div>
      </div>
    );
  }
  switch (item) {
    case "overall":
      return dash(<OverallDashboard />);
    case "categories":
      return dash(
        <div className="grid gap-10">
          {data.categories.map((c) => (
            <section key={c.id} aria-label={c.name} className="grid gap-5">
              <CategoryDashboard slug={c.slug} />
            </section>
          ))}
        </div>,
      );
    case "board":
      return dash(
        <Suspense fallback={<BoardSkeleton />}>
          <BoardDashboard />
        </Suspense>,
      );
    case "calendar":
      return dash(<CalendarDashboard />);
    case "review":
      return dash(<WeeklyReviewDashboard />);
    case "review/month":
      return dash(<MonthlyReviewDashboard />);
    case "settings":
      return dash(<SettingsDashboard />);
    case "relics":
      return <AdminRelics slots={data.relics.slots} trophies={data.relics.trophies} />;
    case "archive":
      return <AdminArchive skills={data.skills} />;
    case "debug":
      return <RoomDebug />;
    default:
      return null;
  }
}
