// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SignInPage from "@/app/auth/signin/page";
import PrivacyPage from "@/app/privacy/page";
import SupportPage from "@/app/support/page";
import TermsPage from "@/app/terms/page";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { locales } from "@/lib/locales";
import { createGraniteConfig } from "../granite.config";

const navigationMocks = vi.hoisted(() => ({ pathname: "/terms" }));

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationMocks.pathname,
}));

vi.mock("@/lib/session/CreatorXSessionProvider", () => ({
  useCreatorXSession: () => ({
    status: "unauthenticated",
    identityKind: "browser",
    subject: null,
    balance: 0,
    error: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  navigationMocks.pathname = "/terms";
  vi.unstubAllEnvs();
});

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

function pngDimensions(path: string) {
  const image = readFileSync(resolve(path));
  expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(image.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

describe("CreatorX legal routes", () => {
  it("states that virtual-point balances, prices, and trades have no cash value", () => {
    render(<TermsPage />);

    expect(
      screen.getByRole("heading", { name: "이용약관" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/가상 포인트 기반 크리에이터 성장 예측 게임/),
    ).toBeInTheDocument();
    expect(screen.getByText(/잔액, 가격 및 거래/)).toBeInTheDocument();
    expect(screen.getByText(/현금 가치가 없/)).toBeInTheDocument();
    expect(screen.getByText(/현금으로 전환하거나 환급/)).toBeInTheDocument();
    expect(screen.getByText(/실제 투자 상품이 아니/)).toBeInTheDocument();
    expect(screen.getByText(/수익을 보장하지 않/)).toBeInTheDocument();
  });

  it("discloses identity, session, trade, retention, deletion, and contact data", () => {
    render(<PrivacyPage />);

    expect(
      screen.getByRole("heading", { name: "개인정보처리방침" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/가명 게임 식별자/)).toBeInTheDocument();
    expect(screen.getByText(/세션 데이터/)).toBeInTheDocument();
    expect(screen.getByText(/주문 및 거래 내역/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "보유 기간" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "삭제 요청" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "문의처" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "개인정보 문의 및 삭제 요청" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/ohe1013/youtube-creator-investment/issues",
    );
  });

  it("publishes the honest sandbox operator and repository support channel", () => {
    render(<SupportPage />);

    expect(
      screen.getByRole("heading", { name: "고객지원" }),
    ).toBeInTheDocument();
    expect(screen.getByText("CreatorX 개발팀")).toBeVisible();
    expect(screen.getByText("GitHub Issues")).toBeVisible();
    expect(screen.getByText("2026-07-10")).toBeVisible();
    expect(screen.getByRole("link", { name: "지원 요청 열기" })).toHaveAttribute(
      "href",
      "https://github.com/ohe1013/youtube-creator-investment/issues",
    );
  });

  it("uses only the configured support channel in production copy", () => {
    for (const [key, value] of Object.entries(validProductionEnvironment)) {
      vi.stubEnv(key, value);
    }

    render(<SupportPage />);

    expect(screen.queryByText(/샌드박스/)).not.toBeInTheDocument();
    expect(screen.queryByText(/저장소 이슈 트래커/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GitHub Issues/)).not.toBeInTheDocument();
    expect(screen.getByText(/운영 환경의 지원 채널/)).toBeVisible();
    expect(screen.getByRole("link", { name: "지원 요청 열기" })).toHaveAttribute(
      "href",
      "https://support.creatorx.example",
    );
  });

  it("links sign-in and the global footer to every legal route", () => {
    const { unmount } = render(<SignInPage />);

    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(
      screen.getByRole("link", { name: "개인정보처리방침" }),
    ).toHaveAttribute("href", "/privacy");

    unmount();
    render(<LegalFooter />);

    expect(screen.getByRole("link", { name: "이용약관" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(
      screen.getByRole("link", { name: "개인정보처리방침" }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "고객지원" })).toHaveAttribute(
      "href",
      "/support",
    );
    expect(screen.getByText(/포인트는 현금 가치가 없/)).toBeVisible();
  });
});

describe("route-aware legal footer", () => {
  it.each(["/", "/dashboard", "/creator"])(
    "does not add document flow below the fixed-height route %s",
    (pathname) => {
      navigationMocks.pathname = pathname;

      render(<LegalFooter />);

      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    },
  );

  it.each(["/terms", "/privacy", "/support", "/auth/signin", "/creators"])(
    "keeps the legal footer on the normal-flow route %s",
    (pathname) => {
      navigationMocks.pathname = pathname;

      render(<LegalFooter />);

      expect(screen.getByRole("contentinfo")).toBeVisible();
    },
  );
});

describe("CreatorX release identity", () => {
  it.each([32, 180, 192, 512, 1024])(
    "renders an undistorted %ipx PNG",
    (size) => {
      expect(
        pngDimensions(`public/brand/creatorx-icon-${size}.png`),
      ).toEqual({ width: size, height: size });
    },
  );

  it("uses only repository-owned SVG geometry and metadata icons", () => {
    const svg = readFileSync(
      resolve("public/brand/creatorx-icon.svg"),
      "utf8",
    );
    const layout = readFileSync(resolve("app/layout.tsx"), "utf8");

    expect(svg).toContain('<rect width="512" height="512" rx="112"');
    expect(svg).toContain("M112 144h288v64H288v160h-64V208H112z");
    expect(svg.toLowerCase()).not.toContain("toss");
    expect(layout).toContain("/brand/creatorx-icon-32.png");
    expect(layout).toContain("/brand/creatorx-icon-180.png");
    expect(layout).toContain("/brand/creatorx-icon-192.png");
    expect(() => readFileSync(resolve("app/favicon.ico"))).toThrow();
  });

  it("uses a local owned data URI in sandbox with the immutable game identity", () => {
    const config = createGraniteConfig({
      NEXT_PUBLIC_APP_IN_TOSS: "1",
      NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL: "sandbox",
      NEXT_PUBLIC_CREATORX_DATA_MODE: "demo",
    });

    expect(config.appName).toBe("creatorx");
    expect(config.brand.displayName).toBe("크리에이터X");
    expect(config.brand.icon).toMatch(/^data:image\/png;base64,/);
    expect(config.brand.icon.toLowerCase()).not.toContain("toss");
    expect(config.permissions).toEqual([]);
    expect(config.webViewProps.type).toBe("game");
  });

  it("uses only an explicit remote HTTPS icon in production", () => {
    const config = createGraniteConfig(validProductionEnvironment);

    expect(config.brand.icon).toBe(
      "https://assets.creatorx.example/creatorx-icon-512.png",
    );
    expect(config.brand.icon).not.toMatch(/^data:/);
  });
});

describe("release-safe visible copy", () => {
  it("uses virtual-point game language on the planned release surfaces", () => {
    const files = [
      "app/auth/signin/page.tsx",
      "app/layout.tsx",
      "app/dashboard/page.tsx",
      "components/dashboard/DashboardClient.tsx",
      "app/creators/page.tsx",
    ].map((path) => readFileSync(resolve(path), "utf8"));

    for (const source of files) {
      expect(source).not.toMatch(/YouTube Creator Investment|가상 투자 게임/);
    }
    expect(files.join("\n")).toMatch(/가상 포인트 기반 크리에이터 성장 예측 게임/);
    expect(files.join("\n")).not.toMatch(
      /Early investors|biggest returns|investment rankings|Discover and invest/,
    );
    expect(locales.ko.portfolio.title).toBe("게임 포트폴리오");
    expect(locales.ko.portfolio.availableCash).toBe("사용 가능 포인트");
    expect(locales.en.portfolio.title).toBe("Game Portfolio");
    expect(locales.en.portfolio.availableCash).toBe("Available Points");
  });
});
