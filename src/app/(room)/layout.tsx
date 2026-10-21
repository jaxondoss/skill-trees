import type { Metadata } from "next";
import { Suspense } from "react";
import { RoomClient } from "@/components/room/RoomClient";
import { ensureOnboarded } from "@/lib/data/onboarding";
import { loadRoomData } from "@/lib/data/room";
import { supabasePublicEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "FORGE · Room" };

/**
 * The room (/ and /room/<zone>). It lives in this layout so stepping between zones (history.pushState) and
 * the refresh after each save keep the same room mounted; the pages render nothing.
 */
export default function RoomLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<p className="p-6 text-sm text-muted">Opening the room.</p>}>
        <Room />
      </Suspense>
      {children}
    </>
  );
}

async function Room() {
  if (!supabasePublicEnv()) {
    return <p className="tile text-sm text-muted">Supabase is not connected yet. Add the keys from .env.example to finish setup (see docs/SETUP.md).</p>;
  }
  await ensureOnboarded();
  return <RoomClient data={await loadRoomData()} />;
}
