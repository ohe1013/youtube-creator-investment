import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  principal: {
    userId: "user-1",
    sessionId: "toss-session-1",
    provider: "toss" as const,
    role: "USER" as const,
  },
  requirePrincipal: vi.fn(),
  unlinkCurrentTossSession: vi.fn(),
}));

vi.mock("@/lib/server/auth/request-auth", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));

vi.mock("@/lib/server/auth/providers/toss", () => ({
  unlinkCurrentTossSession: mocks.unlinkCurrentTossSession,
}));

import { POST } from "@/app/api/auth/toss/unlink/route";

beforeEach(() => {
  mocks.requirePrincipal.mockReset().mockResolvedValue(mocks.principal);
  mocks.unlinkCurrentTossSession.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/auth/toss/unlink", () => {
  it("revokes only the current local CreatorX Toss-session family without a partner Toss API call", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/toss/unlink", { method: "POST" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.unlinkCurrentTossSession).toHaveBeenCalledWith(mocks.principal);
  });
});
