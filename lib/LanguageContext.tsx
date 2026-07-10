"use client";

import React, { createContext, useContext, useSyncExternalStore } from "react";
import { locales, LocaleType } from "./locales";

type TranslationRecord = Record<string, unknown>;
type LocaleStoreListener = () => void;

const DEFAULT_LOCALE: LocaleType = "ko";
const LOCALE_STORAGE_KEY = "locale";
const LOCALE_CHANGE_EVENT = "creatorx:locale-change";

const isLocale = (value: string | null): value is LocaleType =>
  value === "en" || value === "ko";

const getServerLocale = (): LocaleType => DEFAULT_LOCALE;

const getClientLocale = (): LocaleType => {
  if (typeof window === "undefined") return getServerLocale();

  try {
    const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(savedLocale) ? savedLocale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
};

const subscribeToLocale = (listener: LocaleStoreListener): (() => void) => {
  if (typeof window === "undefined") return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(LOCALE_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(LOCALE_CHANGE_EVENT, listener);
  };
};

const setStoredLocale = (newLocale: LocaleType) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
  } catch {
    return;
  }

  window.dispatchEvent(new window.Event(LOCALE_CHANGE_EVENT));
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
  const locale = useSyncExternalStore(
    subscribeToLocale,
    getClientLocale,
    getServerLocale,
  );

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
    <LanguageContext.Provider
      value={{ locale, setLocale: setStoredLocale, t }}
    >
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
