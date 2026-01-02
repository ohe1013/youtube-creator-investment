"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { locales, LocaleType } from "./locales";

type DeepKeyof<T> = T extends object
  ? {
      [K in keyof T]: K extends string ? K | `${K}.${DeepKeyof<T[K]>}` : never;
    }[keyof T]
  : never;

type TranslationKey = DeepKeyof<typeof locales.en>;

interface LanguageContextType {
  locale: LocaleType;
  setLocale: (locale: LocaleType) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleType>("ko");

  useEffect(() => {
    const savedLocale = localStorage.getItem("locale") as LocaleType;
    if (savedLocale && (savedLocale === "en" || savedLocale === "ko")) {
      setLocaleState(savedLocale);
    }
  }, []);

  const setLocale = (newLocale: LocaleType) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  const t = (key: string): string => {
    const localeData = locales[locale];

    // 1. Try exact path if it has dots
    if (key.includes(".")) {
      const keys = key.split(".");
      let result: any = localeData;
      for (const k of keys) {
        if (result && result[k]) {
          result = result[k];
        } else {
          result = undefined;
          break;
        }
      }
      if (typeof result === "string") return result;
    }

    // 2. Try flat search (if not found or if no dot provided)
    // We check common, then market, then channel for priority
    const namespaces = ["common", "market", "channel"] as const;
    const searchKey = key.includes(".") ? key.split(".").pop()! : key;

    for (const ns of namespaces) {
      const nsData = (localeData as any)[ns];
      if (nsData && nsData[searchKey]) {
        return nsData[searchKey];
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
