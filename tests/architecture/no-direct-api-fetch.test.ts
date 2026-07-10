import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeClientBoundaries,
  isProjectOwnedSourcePath,
} from "@/tests/architecture/client-boundary-analyzer";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "components", "hooks", "lib"];

function sourceFiles(): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const candidate = join(path, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
      } else if (entry.isFile() && isProjectOwnedSourcePath(projectPath(candidate))) {
        files.push(candidate);
      }
    }
  };
  for (const root of SOURCE_ROOTS) {
    const candidate = join(ROOT, root);
    if (existsSync(candidate)) visit(candidate);
  }
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !isProjectOwnedSourcePath(entry.name)) continue;
    files.push(join(ROOT, entry.name));
  }
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
