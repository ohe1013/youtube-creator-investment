import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { withApiRoute } from "@/lib/server/http/route-handler";
import { enforceRateLimit } from "@/lib/server/http/rate-limit";

const prisma = new PrismaClient();

afterAll(() => prisma.$disconnect());

function bucketHash(scope: string, identifier: string) {
  const hashSecret = process.env.CREATORX_IDENTITY_PEPPER;
  if (!hashSecret) throw new Error("integration rate-limit pepper is missing");
  return createHmac("sha256", hashSecret)
    .update(`creatorx-rate-limit\0${scope}\0${identifier}`)
    .digest("hex");
}

describe.sequential("PostgreSQL rate limiting", () => {
  it(
    "atomically admits only the configured concurrent request count",
    async () => {
      const scope = `integration-${randomUUID()}`;
      const identifier = `principal-${randomUUID()}@private.example`;
      const keyHash = bucketHash(scope, identifier);
      const handler = withApiRoute(
        async () => {
          const decision = await enforceRateLimit({
            scope,
            identifier,
            maxRequests: 5,
            windowMs: 60_000,
          });
          return Response.json(decision);
        },
        { isProduction: false, developmentOrigins: [] },
      );

      try {
        const responses = await Promise.all(
          Array.from({ length: 20 }, () =>
            handler(new Request("http://localhost/api/rate-limit")),
          ),
        );
        const admitted = responses.filter(
          (response) => response.status === 200,
        );
        const rejected = responses.filter(
          (response) => response.status === 429,
        );

        expect(admitted).toHaveLength(5);
        expect(rejected).toHaveLength(15);
        for (const response of rejected) {
          expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(
            0,
          );
          expect(await response.json()).toMatchObject({
            error: { code: "RATE_LIMITED" },
          });
        }

        const bucket = await prisma.rateLimitBucket.findUniqueOrThrow({
          where: { keyHash },
        });
        expect(bucket.count).toBe(20);
        expect(bucket.keyHash).toHaveLength(64);
        expect(bucket.keyHash).not.toContain(identifier);
      } finally {
        await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
      }
    },
    30_000,
  );

  it("resets an expired bucket atomically", async () => {
    const scope = `expired-${randomUUID()}`;
    const identifier = `ip-${randomUUID()}`;
    const keyHash = bucketHash(scope, identifier);

    await prisma.rateLimitBucket.create({
      data: {
        keyHash,
        count: 99,
        expiresAt: new Date(Date.now() - 10_000),
      },
    });

    try {
      const decision = await enforceRateLimit({
        scope,
        identifier,
        maxRequests: 2,
        windowMs: 60_000,
      });
      const bucket = await prisma.rateLimitBucket.findUniqueOrThrow({
        where: { keyHash },
      });

      expect(decision).toMatchObject({ allowed: true, remaining: 1 });
      expect(bucket.count).toBe(1);
      expect(bucket.expiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
    }
  });

  it("uses PostgreSQL time when resetting a bucket despite a stale app clock", async () => {
    const scope = `database-clock-${randomUUID()}`;
    const identifier = `ip-${randomUUID()}`;
    const keyHash = bucketHash(scope, identifier);

    await prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("keyHash", "count", "expiresAt", "updatedAt")
      VALUES (${keyHash}, 99, CURRENT_TIMESTAMP - INTERVAL '1 second', CURRENT_TIMESTAMP)
    `;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    try {
      const decision = await enforceRateLimit({
        scope,
        identifier,
        maxRequests: 2,
        windowMs: 60_000,
      });
      const bucket = await prisma.rateLimitBucket.findUniqueOrThrow({
        where: { keyHash },
      });

      expect(decision).toMatchObject({ allowed: true, remaining: 1 });
      expect(bucket.count).toBe(1);
    } finally {
      vi.useRealTimers();
      await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
    }
  });
});
