import { Suspense } from "react";
import { BoardDashboard, BoardSkeleton } from "@/components/dashboards/BoardDashboard";

export default function BoardPage() {
  return (
    <main className="flex flex-1 flex-col pt-4 pb-6">
      <Suspense fallback={<BoardSkeleton />}>
        <BoardDashboard />
      </Suspense>
    </main>
  );
}
