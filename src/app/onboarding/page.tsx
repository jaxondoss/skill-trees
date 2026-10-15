import { Suspense } from "react";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { loadOnboarding } from "@/lib/data/onboarding";

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col py-6">
      <Suspense fallback={<div className="glass h-64" aria-busy="true" />}>
        <Steps />
      </Suspense>
    </main>
  );
}

async function Steps() {
  return <Onboarding data={await loadOnboarding()} />;
}
