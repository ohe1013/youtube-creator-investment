import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "@/lib/runtime/config";

describe("parseRuntimeConfig", () => {
  it("allows a sandbox demo", () => {
    expect(
      parseRuntimeConfig({
        NEXT_PUBLIC_APP_IN_TOSS: "1",
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
      }).dataMode,
    ).toBe("demo");
  });

  it("treats an empty optional icon URL as absent", () => {
    expect(
      parseRuntimeConfig({
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
        NEXT_PUBLIC_CREATORX_ICON_URL: "",
      }).brandIconUrl,
    ).toBeNull();
  });

  it.each([
    [
      {
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
      },
      "remote",
    ],
    [
      {
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
      },
      "HTTPS",
    ],
    [
      {
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
        NEXT_PUBLIC_CREATORX_API_BASE_URL: "http://localhost:3000",
      },
      "HTTPS",
    ],
  ])("rejects unsafe production config", (env, message) => {
    expect(() => parseRuntimeConfig(env)).toThrow(message);
  });
});
