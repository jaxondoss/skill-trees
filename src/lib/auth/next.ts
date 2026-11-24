/** The login screen. The only page that opens without a session. */
export const LOGIN_PATH = "/login";

/**
 * Where to go after logging in. Only paths on this site are allowed, so a crafted link
 * (for example /login?next=https://evil.example) cannot send you to another site. Pure, so it is unit tested.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  // "//host" and "/\host" are read by browsers as another site.
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  // No control characters (a tab or newline inside a URL can also change where it points).
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  const path = next.split(/[?#]/)[0];
  if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}/`)) return "/";
  return next;
}
