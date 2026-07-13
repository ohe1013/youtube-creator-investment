import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const prisma = new PrismaClient();
const VIDEO_RACE_ID = "creatorx-integration-video-ownership-race";
const VIDEO_RACE_CREATOR_IDS = [
  "creatorx-integration-video-race-a",
  "creatorx-integration-video-race-b",
] as const;

const previousCronSecret = process.env.CRON_SECRET;
const previousYoutubeKey = process.env.YOUTUBE_API_KEY;
let isolatedRefreshClients: PrismaClient[] = [];

afterEach(async () => {
  process.env.CRON_SECRET = previousCronSecret;
  process.env.YOUTUBE_API_KEY = previousYoutubeKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.allSettled(
    isolatedRefreshClients.map(async (client) => await client.$disconnect()),
  );
  isolatedRefreshClients = [];
  vi.resetModules();
  await prisma.video.deleteMany({ where: { id: VIDEO_RACE_ID } });
  await prisma.creatorStat.deleteMany({
    where: { creatorId: { in: [...VIDEO_RACE_CREATOR_IDS] } },
  });
  await prisma.creator.deleteMany({
    where: { id: { in: [...VIDEO_RACE_CREATOR_IDS] } },
  });
  await prisma.creatorStat.deleteMany({
    where: { creatorId: "creatorx-integration-creator" },
  });
});

afterAll(() => prisma.$disconnect());

describe.sequential("YouTube network and cron boundaries", () => {
  it("keeps the winning creator's video ownership and content during a concurrent same-ID refresh", async () => {
    const [firstCreator, secondCreator] = await Promise.all(
      VIDEO_RACE_CREATOR_IDS.map((id) =>
        prisma.creator.create({
          data: {
            id,
            youtubeChannelId: `${id}-channel`,
            name: `Creator ${id}`,
            currentSubs: 100,
            currentViews: 1000,
            currentVideos: 1,
            currentScore: 1,
            currentPrice: 100,
            initialPrice: 100,
          },
        }),
      ),
    );

    const conditionalWritesReached = Promise.withResolvers<void>();
    let conditionalWrites = 0;
    const createGatedStore = () => {
      const client = new PrismaClient();
      isolatedRefreshClients.push(client);
      return {
        video: {
          async updateMany(
            ...arguments_: Parameters<typeof client.video.updateMany>
          ) {
            const result = await client.video.updateMany(...arguments_);
            conditionalWrites += 1;
            if (conditionalWrites === 2) conditionalWritesReached.resolve();
            await conditionalWritesReached.promise;
            return result;
          },
          async createMany(
            ...arguments_: Parameters<typeof client.video.createMany>
          ) {
            const result = await client.video.createMany(...arguments_);
            return result;
          },
        },
      };
    };
    const firstRefreshStore = createGatedStore();
    const secondRefreshStore = createGatedStore();
    const refreshModule = (await import(
      "@/lib/server/youtube/refresh-creator"
    )) as Record<string, unknown>;
    const persistCreatorVideo = refreshModule.persistCreatorVideo;
    if (typeof persistCreatorVideo !== "function") {
      throw new Error("persistCreatorVideo must provide the atomic video owner write");
    }

    await expect(
      Promise.all([
        persistCreatorVideo(firstRefreshStore, firstCreator.id, {
          id: VIDEO_RACE_ID,
          title: `Video owned by ${firstCreator.id}`,
          thumbnailUrl: `https://img.example.test/video-${firstCreator.id}`,
          publishedAt: "2026-07-10T00:00:00.000Z",
          duration: "PT1M",
          type: "LONG",
          viewCount: 10,
          likeCount: 2,
          commentCount: 1,
        }),
        persistCreatorVideo(secondRefreshStore, secondCreator.id, {
          id: VIDEO_RACE_ID,
          title: `Video owned by ${secondCreator.id}`,
          thumbnailUrl: `https://img.example.test/video-${secondCreator.id}`,
          publishedAt: "2026-07-10T00:00:00.000Z",
          duration: "PT1M",
          type: "LONG",
          viewCount: 10,
          likeCount: 2,
          commentCount: 1,
        }),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    const stored = await prisma.video.findUniqueOrThrow({
      where: { id: VIDEO_RACE_ID },
    });
    expect(conditionalWrites).toBe(2);
    expect(VIDEO_RACE_CREATOR_IDS).toContain(stored.creatorId as never);
    expect(stored.title).toBe(`Video owned by ${stored.creatorId}`);
    expect(stored.thumbnailUrl).toBe(
      `https://img.example.test/video-${stored.creatorId}`,
    );
  }, 15_000);

  it("keeps public creator video reads database-only and never calls YouTube", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/creators/[id]/route");

    const response = await GET(
      new Request(
        "https://api.example.test/api/creators/creatorx-integration-creator?videos=true",
      ),
      { params: Promise.resolve({ id: "creatorx-integration-creator" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ videos: expect.any(Array) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed without CRON_SECRET before performing cron work", async () => {
    delete process.env.CRON_SECRET;
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/internal/cron/update-stats/route");

    const response = await POST(
      new Request("https://api.example.test/api/internal/cron/update-stats", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "CRON_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the stable unauthorized envelope when same-length credential text has different UTF-8 bytes", async () => {
    process.env.CRON_SECRET = "é";
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/internal/cron/update-stats/route");

    const response = await POST(
      new Request("https://api.example.test/api/internal/cron/update-stats", {
        method: "POST",
        headers: { authorization: "Bearer a" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED", requestId: expect.any(String) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the stable unavailable envelope when YouTube is not configured", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    delete process.env.YOUTUBE_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/internal/cron/update-stats/route");

    const response = await POST(
      new Request("https://api.example.test/api/internal/cron/update-stats", {
        method: "POST",
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "YOUTUBE_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses a UTC day upsert when a cron run is repeated", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname.endsWith("/channels")) {
        return Response.json({
          items:
            url.searchParams.get("id") === "creatorx-integration-channel"
              ? [
                  {
                    id: "creatorx-integration-channel",
                    snippet: {
                      title: "CreatorX Integration Creator",
                      thumbnails: { high: { url: "https://img.example.test/thumb" } },
                    },
                    statistics: {
                      subscriberCount: "1001",
                      viewCount: "10001",
                      videoCount: "11",
                    },
                  },
                ]
              : [],
        });
      }
      if (url.pathname.endsWith("/playlistItems")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected YouTube request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/internal/cron/update-stats/route");
    const request = () =>
      new Request("https://api.example.test/api/internal/cron/update-stats", {
        method: "POST",
        headers: { authorization: "Bearer cron-test-secret" },
      });

    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(200);

    const stats = await prisma.creatorStat.findMany({
      where: {
        creatorId: "creatorx-integration-creator",
        period: "DAILY",
      },
    });
    expect(stats).toHaveLength(1);
    expect(stats[0]?.date.toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
    );
    const integrationChannelReads = fetchSpy.mock.calls.filter(([input]) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : input.toString(),
      );
      return url.searchParams.get("id") === "creatorx-integration-channel";
    });
    expect(integrationChannelReads).toHaveLength(2);
  });
});
