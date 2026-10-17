// Mimics the Supabase endpoints the app uses: /auth/v1/token (owner password sign-in), /auth/v1/user (token check)
// and /rest/v1 (PostgREST).
import { createServer } from "node:http";
import { GATEWAY_PORT, OWNER_PASSWORD, POSTGREST_PORT, session, USER_EMAIL, verifyJwt } from "./config.mjs";

const PASS_HEADERS = ["authorization", "apikey", "prefer", "accept", "content-type", "accept-profile", "content-profile", "range"];
const RETURN_HEADERS = ["content-type", "content-range", "preference-applied", "location"];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${GATEWAY_PORT}`);

  if (url.pathname === "/auth/v1/user") {
    const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!claims?.sub) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ code: 401, msg: "invalid JWT" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        id: claims.sub,
        aud: "authenticated",
        role: "authenticated",
        email: claims.email ?? USER_EMAIL,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      }),
    );
    return;
  }

  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const body = JSON.parse(String((await readBody(req)) ?? "{}"));
    if (body.email !== USER_EMAIL || body.password !== OWNER_PASSWORD) {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(session()));
    return;
  }

  if (url.pathname === "/auth/v1/logout") {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname.startsWith("/rest/v1")) {
    const headers = {};
    for (const h of PASS_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
    const upstream = await fetch(`http://localhost:${POSTGREST_PORT}${url.pathname.slice("/rest/v1".length) || "/"}${url.search}`, {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await readBody(req),
    });
    const out = {};
    for (const h of RETURN_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(upstream.status, out).end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  res.writeHead(404).end();
}).listen(GATEWAY_PORT, () => console.log(`gateway on :${GATEWAY_PORT}`));
