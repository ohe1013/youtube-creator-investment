import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const retiredModules = ["lib/matching-engine.ts", "lib/youtube.ts"] as const;
const migratedCallers = [
  "lib/bot-manager.ts",
  "scripts/seed-liquidity.ts",
  "scripts/refresh-all-stats.ts",
  "scripts/refresh-creator-meta.ts",
  "test-youtube.ts",
] as const;
const commandLineYouTubeCallers = [
  "scripts/refresh-all-stats.ts",
  "scripts/refresh-creator-meta.ts",
] as const;
const tradeDiagnostics = [
  "scripts/verify-bots.ts",
  "scripts/debug-orders.mjs",
] as const;

describe("retired server module boundaries", () => {
  it("removes the legacy engine and YouTube modules after their callers use server-owned APIs", () => {
    for (const modulePath of retiredModules) {
      expect(existsSync(join(ROOT, modulePath))).toBe(false);
    }

    for (const caller of migratedCallers) {
      const source = readFileSync(join(ROOT, caller), "utf8");
      expect(source).not.toMatch(/(?:matching-engine|lib\/youtube)/);
    }
  });

  it("keeps command-line YouTube refreshes responsible for loading their environment", () => {
    for (const caller of commandLineYouTubeCallers) {
      expect(readFileSync(join(ROOT, caller), "utf8")).toContain('import "dotenv/config";');
    }
  });

  it("routes the supported bulk-refresh command through the repeat-safe creator refresh boundary", () => {
    const source = readFileSync(
      join(ROOT, "scripts/refresh-all-stats.ts"),
      "utf8",
    );

    expect(source).toContain("refreshCreator");
    expect(source).not.toContain("prisma.video.upsert");
    expect(source).not.toContain("prisma.creatorStat.create");
  });

  it("keeps bot diagnostics on Task 6 execution records", () => {
    for (const diagnostic of tradeDiagnostics) {
      const source = readFileSync(join(ROOT, diagnostic), "utf8");
      expect(source).toContain("tradeExecution");
      expect(source).not.toContain("legacyTrade");
    }

    const botVerification = readFileSync(
      join(ROOT, "scripts/verify-bots.ts"),
      "utf8"
    );
    expect(botVerification).toMatch(/buyer:\s*\{\s*isBot:\s*true\s*\}/);
    expect(botVerification).toMatch(/seller:\s*\{\s*isBot:\s*true\s*\}/);

    const orderDebugger = readFileSync(
      join(ROOT, "scripts/debug-orders.mjs"),
      "utf8"
    );
    expect(orderDebugger).toContain('orderBy: { executedAt: "desc" }');
  });
});
