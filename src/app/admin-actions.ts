"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { currentUserIsAdmin } from "@/lib/data/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const fail = (error: string): ActionResult => ({ ok: false, error });
const uuid = z.string().uuid();

/**
 * Admin view: move a skill to another category. Admin only (ADMIN_EMAILS). Both rows are read under RLS first,
 * so a skill or category of another user is "unknown" even before the update's own RLS check.
 */
export async function setSkillCategory(skillId: string, categoryId: string): Promise<ActionResult> {
  if (!uuid.safeParse(skillId).success || !uuid.safeParse(categoryId).success) return fail("Unknown skill or category.");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
  if (!uid) return fail("Sign in again.");
  if (!(await currentUserIsAdmin(supabase))) return fail("Admins only.");
  const [skill, cat] = await Promise.all([
    supabase.from("skills").select("id").eq("id", skillId).eq("user_id", uid).maybeSingle(),
    supabase.from("categories").select("id").eq("id", categoryId).eq("user_id", uid).maybeSingle(),
  ]);
  if (!skill.data) return fail("Unknown skill.");
  if (!cat.data) return fail("Unknown category.");
  const { error } = await supabase.from("skills").update({ category_id: categoryId }).eq("id", skillId).eq("user_id", uid);
  if (error) return fail(error.message);
  refresh();
  return { ok: true };
}
