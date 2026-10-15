import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  // Cached pages and the offline queue belong to this account: clear them on this device.
  res.headers.set("Clear-Site-Data", '"cache", "storage"');
  return res;
}
