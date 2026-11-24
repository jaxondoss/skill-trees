"use server";

import { redirect } from "next/navigation";
import { LOGIN_PATH, safeNext } from "@/lib/auth/next";
import { createClient } from "@/lib/supabase/server";
import { seedUserFromTemplate } from "@/seed/seedUser";

/** Logs in with a Supabase email and password, then opens the page the visitor asked for. */
export async function logIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));
  const back = (error: string) => {
    const q = new URLSearchParams({ error });
    if (next !== "/") q.set("next", next);
    return `${LOGIN_PATH}?${q}`;
  };
  if (!email || !password) redirect(back("missing"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure, so the page does not tell a stranger which emails have accounts.
  if (error) redirect(back("invalid"));
  try {
    // First login only: adds the starting skills. Does nothing when they are already there.
    await seedUserFromTemplate(supabase);
  } catch (e) {
    console.error(e);
  }
  redirect(next);
}

/** Ends the session on this device and goes back to the login screen. */
export async function logOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
