import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: prismaMocks.queryRaw,
  },
}));

import { GET } from "@/app/api/health/route";

const originalRevision = process.env.VERCEL_GIT_COMMIT_SHA;

beforeEach(() => {
  prismaMocks.queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  process.env.VERCEL_GIT_COMMIT_SHA = "a1b2c3d4";
});

afterEach(() => {
  if (originalRevision === undefined) {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  } else {
    process.env.VERCEL_GIT_COMMIT_SHA = originalRevision;
  }
});

describe("GET /api/health", () => {
  it("returns a no-store database health response with a safe build revision", async () => {
    const response = await GET(new Request("http://localhost/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      revision: "a1b2c3d4",
    });
    expect(prismaMocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("reports database unavailability without exposing the database error", async () => {
    prismaMocks.queryRaw.mockRejectedValue(
      new Error("postgresql://runtime:password@db.internal/creatorx"),
    );
    process.env.VERCEL_GIT_COMMIT_SHA = "not-a-safe-revision";

    const response = await GET(new Request("http://localhost/api/health"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ status: "unavailable", revision: "unknown" });
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
