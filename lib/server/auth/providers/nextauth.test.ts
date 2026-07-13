import { describe, expect, it, vi } from "vitest";

import { resolveNextAuthPrincipal } from "@/lib/server/auth/providers/nextauth";

describe("NextAuth browser principal", () => {
  it("uses the database role instead of the role supplied by the browser session", async () => {
    const getSession = vi.fn().mockResolvedValue({
      user: { id: "browser-user", role: "ADMIN" },
    });
    const findUser = vi.fn().mockResolvedValue({
      id: "browser-user",
      role: "USER",
    });

    await expect(
      resolveNextAuthPrincipal({ getSession, findUser }),
    ).resolves.toEqual({
      userId: "browser-user",
      provider: "google",
      role: "USER",
    });
    expect(findUser).toHaveBeenCalledWith("browser-user");
  });

  it("rejects a browser session whose user no longer exists", async () => {
    await expect(
      resolveNextAuthPrincipal({
        getSession: async () => ({ user: { id: "deleted-user", role: "ADMIN" } }),
        findUser: async () => null,
      }),
    ).resolves.toBeNull();
  });
});
