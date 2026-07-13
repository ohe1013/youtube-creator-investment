"use client";

import { ThemeProvider } from "next-themes";

import { AppInTossRuntime } from "@/components/AppInTossRuntime";
import { CreatorXDataProvider } from "@/components/runtime/CreatorXDataProvider";
import { LanguageProvider } from "@/lib/LanguageContext";
import { parseRuntimeConfig } from "@/lib/runtime/config";
import { CreatorXSessionProvider } from "@/lib/session/CreatorXSessionProvider";
import { CreatorXTokenRuntimeProvider } from "@/lib/session/CreatorXTokenRuntime";

const config = parseRuntimeConfig({
  NEXT_PUBLIC_APP_IN_TOSS: process.env.NEXT_PUBLIC_APP_IN_TOSS,
  NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL:
    process.env.NEXT_PUBLIC_CREATORX_RELEASE_CHANNEL,
  NEXT_PUBLIC_CREATORX_DATA_MODE: process.env.NEXT_PUBLIC_CREATORX_DATA_MODE,
  NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED:
    process.env.NEXT_PUBLIC_CREATORX_TOSS_LOGIN_ENABLED,
  NEXT_PUBLIC_CREATORX_API_BASE_URL:
    process.env.NEXT_PUBLIC_CREATORX_API_BASE_URL,
  NEXT_PUBLIC_CREATORX_OPERATOR_NAME:
    process.env.NEXT_PUBLIC_CREATORX_OPERATOR_NAME,
  NEXT_PUBLIC_CREATORX_SUPPORT_URL:
    process.env.NEXT_PUBLIC_CREATORX_SUPPORT_URL,
  NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT:
    process.env.NEXT_PUBLIC_CREATORX_PRIVACY_CONTACT,
  NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE:
    process.env.NEXT_PUBLIC_CREATORX_LEGAL_EFFECTIVE_DATE,
  NEXT_PUBLIC_CREATORX_ICON_URL: process.env.NEXT_PUBLIC_CREATORX_ICON_URL,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={config.appInToss ? "light" : "dark"}
      enableSystem={false}
      forcedTheme={config.appInToss ? "light" : undefined}
    >
      <LanguageProvider>
        <AppInTossRuntime enabled={config.appInToss} />
        <CreatorXTokenRuntimeProvider config={config}>
          <CreatorXDataProvider config={config}>
            <CreatorXSessionProvider config={config}>
              {children}
            </CreatorXSessionProvider>
          </CreatorXDataProvider>
        </CreatorXTokenRuntimeProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
