import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "components", "lib"];
const SESSION_ADAPTER = "lib/session/CreatorXSessionProvider.tsx";

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
  it("keeps client components off direct relative API fetch calls", () => {
    const violations = sourceFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const isClient = /^\s*["']use client["'];/m.test(source);
      const directApiFetch =
        /\bfetch\s*\(\s*(?:"\/api(?:\/|\?|"|$)|'\/api(?:\/|\?|'|$)|`\/api(?:\/|\?|`|\$\{))/m;
      return isClient && directApiFetch.test(source) ? [projectPath(path)] : [];
    });
    expect(violations).toEqual([]);
  });

  it("forbids fetch reassignment and the retired App-in-Toss shim", () => {
    const violations = sourceFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return /(?:window|globalThis|global)\s*\.\s*fetch\s*=/.test(source) ||
        /\binstallAppInTossFetch\b|appintoss-fetch/.test(source)
        ? [projectPath(path)]
        : [];
    });
    expect(violations).toEqual([]);
    expect(existsSync(join(ROOT, "lib", "appintoss-fetch.ts"))).toBe(false);
  });

  it("isolates NextAuth session hooks and sign-out inside the browser adapter", () => {
    const violations = sourceFiles().flatMap((path) => {
      const rel = projectPath(path);
      const source = readFileSync(path, "utf8");
      const usesRestrictedNextAuth =
        /from\s+["']next-auth\/react["']/.test(source) &&
        /\b(?:useSession|signOut)\b/.test(source);
      return usesRestrictedNextAuth && rel !== SESSION_ADAPTER ? [rel] : [];
    });
    expect(violations).toEqual([]);
  });

  it("removes the dynamic creator detail route", () => {
    expect(existsSync(join(ROOT, "app", "creators", "[id]", "page.tsx"))).toBe(
      false,
    );
  });
});
