import { Suspense } from "react";
import { SkillDashboard } from "@/components/dashboards/SkillDashboard";

/** Skill page (spec v2 r2, 5): header, the to-do lists, the skill's numbers, recent and history. */
export default function SkillPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <main className="flex flex-1 flex-col pt-4 pb-6">
      <Suspense fallback={<div className="tile h-64" aria-busy="true" />}>
        <Skill params={params} />
      </Suspense>
    </main>
  );
}

async function Skill({ params }: { params: PageProps<"/s/[slug]">["params"] }) {
  const { slug } = await params;
  return <SkillDashboard slug={slug} />;
}
