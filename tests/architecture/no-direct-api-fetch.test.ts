import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeClientBoundaries } from "@/tests/architecture/client-boundary-analyzer";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "components", "lib"];

function sourceFiles(): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path)) {
      const candidate = join(path, entry);
      if (statSync(candidate).isDirectory()) {
        visit(candidate);
      } else if (
        /\.(?:ts|tsx)$/.test(entry) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry)
      ) {
        files.push(candidate);
      }
    }
  };
  for (const root of SOURCE_ROOTS) visit(join(ROOT, root));
  return files;
}

function projectPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

describe("typed client architecture", () => {
  it("keeps the complete client import graph behind typed boundaries", () => {
    const sources = Object.fromEntries(
      sourceFiles().map((path) => [projectPath(path), readFileSync(path, "utf8")]),
    );
    expect(analyzeClientBoundaries(sources)).toEqual([]);
  });

  it("removes the retired App-in-Toss fetch shim", () => {
    expect(existsSync(join(ROOT, "lib", "appintoss-fetch.ts"))).toBe(false);
  });

  it("removes the dynamic creator detail route", () => {
    expect(existsSync(join(ROOT, "app", "creators", "[id]", "page.tsx"))).toBe(
      false,
    );
  });
});
