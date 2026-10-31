import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Spec rule 0.6: no em dashes anywhere in UI copy. Checked across all app source and seed content. */
const ROOT = join(__dirname, "..", "..");
const DIRS = ["src", "supabase"];
const EXT = /\.(tsx?|css|sql|json|md)$/;
// The room prototype's engine and ui (the app serves a copy of them) and its two live pages.
const PROTO = join(ROOT, "docs", "redesign", "room-prototype");
const PROTO_DIRS = ["engine", "ui"].map((d) => join(PROTO, d));
const PROTO_EXT = /\.(js|css|html)$/;
const PROTO_PAGES = ["index.html", "forge-v3-4.html"].map((f) => join(PROTO, f));

function walk(dir: string, ext = EXT): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(name) ? [p] : [];
  });
}

describe("copy rules", () => {
  it("has no em dashes in source or seed content", () => {
    const files = [
      ...DIRS.flatMap((d) => walk(join(ROOT, d))),
      ...PROTO_DIRS.flatMap((d) => walk(d, PROTO_EXT)),
      ...PROTO_PAGES,
    ];
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (line.includes("—") ? [`${relative(ROOT, file)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
