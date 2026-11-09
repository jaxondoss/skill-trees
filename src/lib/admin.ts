/**
 * Admin access (admin view, PLAN Phase 1): ADMIN_EMAILS is a comma list of emails, set in Vercel.
 * Unset or empty means nobody is an admin. Pure, so it is unit tested; the session lookup is in lib/data/admin.ts.
 */
export function adminEmails(env: string | undefined = process.env.ADMIN_EMAILS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True when the user's email is in ADMIN_EMAILS (case-insensitive). */
export function isAdmin(user: { email?: string | null } | null | undefined, env?: string): boolean {
  const email = user?.email?.trim().toLowerCase();
  return !!email && adminEmails(env).has(email);
}
