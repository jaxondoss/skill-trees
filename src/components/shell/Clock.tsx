"use client";

import { useEffect, useState } from "react";

const fmt = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The header clock, 24-hour, in the viewer's local time. */
export function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(fmt(new Date()));
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <b className={className} suppressHydrationWarning>
      {now ?? "--:--"}
    </b>
  );
}
