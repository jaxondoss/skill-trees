import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** Spec rule 0.6: no em dashes anywhere in UI copy. Checked across all app source and seed content. */
const ROOT = join(__dirname, "..", "..");
const DIRS = ["src", "supabase"];
const EXT = /\.(tsx?|css|sql|json|md)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : EXT.test(name) ? [p] : [];
  });
}

describe("copy rules", () => {
  it("has no em dashes in source or seed content", () => {
    const offenders = DIRS.flatMap((d) => walk(join(ROOT, d))).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (line.includes("—") ? [`${relative(ROOT, file)}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
