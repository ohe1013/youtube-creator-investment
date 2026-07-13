import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ executeBotTrade: vi.fn() }));

vi.mock("@/lib/bot-manager", () => ({
  executeBotTrade: mocks.executeBotTrade,
}));

const previousCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  process.env.CRON_SECRET = previousCronSecret;
  mocks.executeBotTrade.mockReset();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("bot activity cron boundary", () => {
  it("fails closed without CRON_SECRET before any bot trade can execute", async () => {
    delete process.env.CRON_SECRET;
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { POST } = await import("@/app/api/internal/cron/bot-activity/route");

    const response = await POST(
      new Request("https://api.example.test/api/internal/cron/bot-activity", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "CRON_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(mocks.executeBotTrade).not.toHaveBeenCalled();
  });
});
