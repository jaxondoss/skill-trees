// Local end-to-end stack: Postgres (real migrations) + PostgREST + a small auth stub.
// Test-only values. Nothing here is a real credential.
import { createHmac } from "node:crypto";

export const JWT_SECRET = "forge-e2e-only-secret-not-used-anywhere-else";
export const USER_ID = "e2e00000-0000-4000-8000-000000000001";
export const USER_EMAIL = "e2e@forge.test";

export const PG_PORT = 54339;
export const POSTGREST_PORT = 54331;
export const GATEWAY_PORT = 54321;
export const APP_PORT = 3200;

export const SUPABASE_URL = `http://localhost:${GATEWAY_PORT}`;
/** Cookie name @supabase/ssr derives from the URL's first hostname label. */
export const AUTH_COOKIE = "sb-localhost-auth-token";

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function signJwt(payload) {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token) {
  const [head, body, sig] = String(token).split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/** Stands in for the publishable key: an anon-role JWT PostgREST accepts. */
export const ANON_KEY = signJwt({ role: "anon", iss: "forge-e2e", exp: 4102444800 });

/** A signed-in session cookie value in the format @supabase/ssr reads. */
export function sessionCookieValue() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = signJwt({ sub: USER_ID, email: USER_EMAIL, role: "authenticated", aud: "authenticated", exp });
  const session = {
    access_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: "e2e-refresh",
    user: { id: USER_ID, email: USER_EMAIL, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  };
  return `base64-${b64url(session)}`;
}
