"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { LanguageProvider } from "@/lib/LanguageContext";
import { AppInTossRuntime } from "@/components/AppInTossRuntime";
import { installAppInTossFetch, isAppInTossMode } from "@/lib/appintoss-fetch";

const appInTossMode = isAppInTossMode();
export function Providers({ children }: { children: React.ReactNode }) {
  installAppInTossFetch();

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={appInTossMode ? "light" : "dark"}
      enableSystem={false}
      forcedTheme={appInTossMode ? "light" : undefined}
    >
      <LanguageProvider>
        <SessionProvider>
          <AppInTossRuntime />
          {children}
        </SessionProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
