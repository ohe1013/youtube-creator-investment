import { expect, it } from "vitest";

import { authOptions } from "@/lib/auth";

it("provides the NextAuth v4 database adapter runtime contract", () => {
  const adapter = authOptions.adapter;
  expect(adapter).toBeDefined();

  for (const method of [
    "createUser",
    "getUser",
    "getUserByEmail",
    "getUserByAccount",
    "updateUser",
    "linkAccount",
    "createSession",
    "getSessionAndUser",
    "updateSession",
    "deleteSession",
  ] as const) {
    expect(adapter?.[method]).toBeTypeOf("function");
  }
});

it("copies database identity fields into a session", async () => {
  const sessionCallback = authOptions.callbacks?.session;
  expect(sessionCallback).toBeTypeOf("function");
  if (!sessionCallback) throw new Error("Session callback is required");

  const session = await sessionCallback({
    session: {
      expires: "2026-07-11T00:00:00.000Z",
      user: {
        id: "stale-id",
        name: "Creator",
        email: "creator@example.com",
        image: null,
        balance: 0,
        role: "USER",
      },
    },
    user: {
      id: "user-1",
      name: "Creator",
      email: "creator@example.com",
      emailVerified: null,
      image: null,
      balance: 125_000,
      role: "ADMIN",
    },
    token: {},
    newSession: {},
    trigger: "update",
  });

  expect(session.user).toMatchObject({
    id: "user-1",
    balance: 125_000,
    role: "ADMIN",
  });
});
