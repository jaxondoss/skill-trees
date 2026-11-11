import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T10 (v3.5): the room's three script lists agree. The prototype pages (index.html, forge-v3-4.html) and the app
 * (RoomClient.tsx SCRIPTS) load the same engine and ui scripts in the same order, up to the art bundle's name and
 * ui/drawer.js (prototype only). Stylesheets likewise. With ROOM_SYNC_CHECK=1 (integration only) public/room must
 * equal the prototype's engine and ui.
 */
const ROOT = join(__dirname, "..", "..");
const PROTO = join(ROOT, "docs", "redesign", "room-prototype");
const CLIENT = join(ROOT, "src", "components", "room", "RoomClient.tsx");

// data.js and lyfta.js (the owner's Lyfta snapshot) are prototype-only data, like the art bundle
const isArt = (s: string) => /^(art[\w.-]*|test-fixture-art|data|lyfta)\.js$/.test(s);

function htmlScripts(file: string) {
  const html = readFileSync(join(PROTO, file), "utf8");
  return [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1] as string);
}
function htmlStyles(file: string) {
  const html = readFileSync(join(PROTO, file), "utf8");
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] as string);
}
function clientScripts() {
  const src = readFileSync(CLIENT, "utf8");
  const block = /const SCRIPTS = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error("SCRIPTS not found in RoomClient.tsx");
  return [...(block[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}
function clientStyles() {
  const src = readFileSync(CLIENT, "utf8");
  return [...src.matchAll(/href="\/room\/([^"]+\.css)"/g)].map((m) => m[1] as string);
}
const engineList = (list: string[]) => list.filter((s) => !isArt(s) && s !== "ui/drawer.js");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("room script lists (T10)", () => {
  it("both prototype pages load the same scripts and stylesheets", () => {
    expect(htmlScripts("forge-v3-4.html")).toEqual(htmlScripts("index.html"));
    expect(htmlStyles("forge-v3-4.html")).toEqual(htmlStyles("index.html"));
  });

  it("the app loads the prototype's engine and ui scripts in the same order", () => {
    const proto = engineList(htmlScripts("index.html"));
    expect(engineList(clientScripts())).toEqual(proto);
    expect(proto[0]).toBe("engine/core.js");
    expect(proto[proto.length - 1]).toBe("engine/main.js");
    for (const s of proto) expect(existsSync(join(PROTO, s)), s).toBe(true);
  });

  it("the v3.5 engine files load in their slots", () => {
    const list = engineList(htmlScripts("index.html"));
    const at = (s: string) => list.indexOf(s);
    expect(at("engine/nav.js")).toBe(at("engine/overlay.js") + 1);
    expect(at("engine/input.js")).toBe(at("engine/nav.js") + 1);
    expect(at("engine/wire.js")).toBe(at("engine/glow.js") + 1);
    expect(at("engine/skill.js")).toBe(at("engine/calendar.js") + 1);
    expect(at("engine/overview.js")).toBe(at("engine/skill.js") + 1);
  });

  it("the app links the prototype's stylesheets", () => {
    expect(clientStyles()).toEqual(htmlStyles("index.html"));
  });

  it.runIf(process.env.ROOM_SYNC_CHECK === "1")("public/room equals the prototype's engine and ui", () => {
    const out = join(ROOT, "public", "room");
    for (const dir of ["engine", "ui"]) {
      for (const f of walk(join(PROTO, dir))) {
        const rel = relative(PROTO, f);
        expect(readFileSync(join(out, rel), "utf8"), rel).toBe(readFileSync(f, "utf8"));
      }
    }
    expect(readFileSync(join(out, "styles.css"), "utf8")).toBe(readFileSync(join(PROTO, "styles.css"), "utf8"));
  });
});
