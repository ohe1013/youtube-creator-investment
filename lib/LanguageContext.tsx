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
    const keys = key.split(".");
    let result: any = locales[locale];

    for (const k of keys) {
      if (result && result[k]) {
        result = result[k];
      } else {
        return key; // Fallback to key if not found
      }
    }

    return result as string;
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
