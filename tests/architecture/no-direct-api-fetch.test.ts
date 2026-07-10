import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeClientBoundaries,
  isProjectOwnedSourcePath,
} from "@/tests/architecture/client-boundary-analyzer";

const ROOT = process.cwd();
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".superpowers",
  "__tests__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "prisma",
  "scripts",
  "tests",
]);

function sourceFiles(): string[] {
  const files: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const candidate = join(path, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) visit(candidate);
      } else if (entry.isFile() && isProjectOwnedSourcePath(projectPath(candidate))) {
        files.push(candidate);
      }
    }
  };
  visit(ROOT);
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
