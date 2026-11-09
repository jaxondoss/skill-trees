"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** True on the room routes: / and /room/<zone>. */
export const isRoomPath = (path: string) => path === "/" || path === "/room" || path.startsWith("/room/");

/** True on the admin view (/admin and /admin/<item>): it draws its own full-screen blueprint. */
export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

/** Shell chrome (dock, live field, pointer light) stays off the room and the admin view: they own the screen. */
export function OffRoom({ children }: { children: ReactNode }) {
  const path = usePathname();
  return isRoomPath(path) || isAdminPath(path) ? null : children;
}
