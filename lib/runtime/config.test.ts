import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "@/lib/runtime/config";

describe("parseRuntimeConfig", () => {
  const validProductionEnvironment = {
    NEXT_PUBLIC_APP_IN_TOSS: "1",
    NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "production",
    NEXT_PUBLIC_CREATORX_DATA_MODE: "remote",
    NEXT_PUBLIC_CREATORX_API_BASE_URL: "https://api.creatorx.example",
    NEXT_PUBLIC_CREATORX_OPERATOR_NAME: "CreatorX 운영사",
    NEXT_PUBLIC_CREATORX_SUPPORT_URL: "https://support.creatorx.example",
    NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT: "privacy@creatorx.example",
    NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE: "2026-07-10",
    NEXT_PUBLIC_CREATORX_ICON_URL:
      "https://assets.creatorx.example/creatorx-icon-512.png",
  };

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

  it.each([
    [undefined, "required"],
    ["data:image/png;base64,bG9jYWw=", "remote HTTPS"],
    ["http://assets.creatorx.example/icon.png", "remote HTTPS"],
    ["https://localhost/icon.png", "remote HTTPS"],
    ["https://127.0.0.1/icon.png", "remote HTTPS"],
    ["https://[::1]/icon.png", "remote HTTPS"],
    ["https://10.0.0.2/icon.png", "remote HTTPS"],
    ["https://172.16.0.2/icon.png", "remote HTTPS"],
    ["https://192.168.0.2/icon.png", "remote HTTPS"],
    ["https://creatorx-local/icon.png", "remote HTTPS"],
    ["https://static.toss.im/icons/icon-toss-logo.png", "CreatorX-owned"],
  ])("rejects an unsafe production brand icon: %s", (icon, message) => {
    expect(() =>
      parseRuntimeConfig({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_ICON_URL: icon,
      }),
    ).toThrow(message);
  });

  it("accepts an explicit CreatorX-owned remote HTTPS production icon", () => {
    expect(parseRuntimeConfig(validProductionEnvironment).brandIconUrl).toBe(
      "https://assets.creatorx.example/creatorx-icon-512.png",
    );
  });

  it.each([
    "not a URL",
    "https://localhost/api",
    "https://127.0.0.1/api",
    "https://[::1]/api",
    "https://10.0.0.2/api",
    "https://172.16.0.2/api",
    "https://192.168.0.2/api",
    "https://creatorx-local/api",
  ])("rejects a device-local production API URL: %s", (apiBaseUrl) => {
    expect(() =>
      parseRuntimeConfig({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_API_BASE_URL: apiBaseUrl,
      }),
    ).toThrow("remote HTTPS API URL");
  });

  it.each([
    "http://support.creatorx.example",
    "https://localhost/support",
    "https://127.0.0.1/support",
    "https://[::1]/support",
    "https://10.0.0.2/support",
    "https://172.16.0.2/support",
    "https://192.168.0.2/support",
    "https://creatorx-local/support",
  ])("rejects a non-remote production support URL: %s", (supportUrl) => {
    expect(() =>
      parseRuntimeConfig({
        ...validProductionEnvironment,
        NEXT_PUBLIC_CREATORX_SUPPORT_URL: supportUrl,
      }),
    ).toThrow("remote HTTPS support URL");
  });

  it("keeps honest sandbox legal defaults", () => {
    expect(
      parseRuntimeConfig({
        NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
        NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
      }).legal,
    ).toEqual({
      operatorName: "CreatorX 개발팀",
      supportUrl:
        "https://github.com/ohe1013/youtube-creator-investment/issues",
      privacyContact: "GitHub Issues",
      effectiveDate: "2026-07-10",
    });
  });
});
