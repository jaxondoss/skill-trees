"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** True on the room routes: / and /room/<zone>. */
export const isRoomPath = (path: string) => path === "/" || path === "/room" || path.startsWith("/room/");

/** Shell chrome (dock, live field, pointer light) stays off the room: the canvas owns the screen there. */
export function OffRoom({ children }: { children: ReactNode }) {
  const path = usePathname();
  return isRoomPath(path) ? null : children;
}
