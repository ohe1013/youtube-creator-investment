"use client";

import React, { createContext, useContext, useState } from "react";
import { locales, LocaleType } from "./locales";

type TranslationRecord = Record<string, unknown>;

const isLocale = (value: string | null): value is LocaleType =>
  value === "en" || value === "ko";

const getInitialLocale = (): LocaleType => {
  if (typeof window === "undefined") return "ko";

  const savedLocale = window.localStorage.getItem("locale");
  return isLocale(savedLocale) ? savedLocale : "ko";
};

const isTranslationRecord = (value: unknown): value is TranslationRecord =>
  typeof value === "object" && value !== null;

const getNestedTranslation = (
  root: unknown,
  keys: string[]
): unknown => {
  let result = root;

  for (const key of keys) {
    if (!isTranslationRecord(result) || !result[key]) return undefined;
    result = result[key];
  }

  return result;
};

interface LanguageContextType {
  locale: LocaleType;
  setLocale: (locale: LocaleType) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleType>(getInitialLocale);

  const setLocale = (newLocale: LocaleType) => {
    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("locale", newLocale);
    }
  };

  const t = (key: string): string => {
    const localeData = locales[locale];

    // 1. Try exact path if it has dots
    if (key.includes(".")) {
      const result = getNestedTranslation(localeData, key.split("."));
      if (typeof result === "string") return result;
    }

    // 2. Try flat search (if not found or if no dot provided)
    // We check common, then market, then channel for priority
    const namespaces = ["common", "market", "channel"] as const;
    const searchKey = key.includes(".") ? key.split(".").pop()! : key;

    for (const ns of namespaces) {
      const nsData: unknown = localeData[ns];
      if (isTranslationRecord(nsData)) {
        const result = nsData[searchKey];
        if (typeof result === "string" && result.length > 0) return result;
      }
    }

    // 3. Last fallback: return the last segment of the key
    return searchKey;
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
