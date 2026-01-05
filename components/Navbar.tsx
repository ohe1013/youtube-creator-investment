"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/lib/LanguageContext";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useLanguage();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <nav className="bg-background border-b border-border-exchange sticky top-0 z-50 h-14" />
    );
  }

  return (
    <nav className="sticky top-0 z-50 bg-gradient-to-r from-brand-blue to-brand-red dark:from-background dark:to-background border-b border-white/10 dark:border-border-exchange">
      <div className="container mx-auto px-4 lg:px-6">
        <div className="flex justify-between items-center h-14">
          {/* Logo and Primary Nav */}
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-xl font-black tracking-tighter text-white dark:text-primary">
                CREATOR
                <span className="text-white/80 dark:text-foreground">X</span>
              </span>
            </Link>

            <div className="hidden md:flex items-center space-x-6">
              <Link
                href="/creators"
                className="text-sm font-medium text-white/90 hover:text-white dark:text-foreground dark:hover:text-primary transition-colors"
              >
                {t("common.creators")}
              </Link>
              <Link
                href="/dashboard"
                className="text-sm font-medium text-white/90 hover:text-white dark:text-foreground dark:hover:text-primary transition-colors"
              >
                {t("common.dashboard")}
              </Link>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-4">
            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-lg hover:bg-white/10 dark:hover:bg-card transition-colors text-white dark:text-foreground"
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M16.071 16.071l.707.707M7.757 7.757l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

            {/* Language Toggle */}
            <button
              onClick={() => setLocale(locale === "ko" ? "en" : "ko")}
              className="px-2 py-1 text-xs font-bold rounded border border-white/30 dark:border-border-exchange hover:border-white text-white dark:text-foreground transition-colors"
            >
              {locale.toUpperCase()}
            </button>

            {/* Desktop User Actions */}
            <div className="hidden md:flex items-center space-x-6 h-14">
              {status === "authenticated" ? (
                <>
                  <Link
                    href="/portfolio"
                    className="flex items-center space-x-2 text-sm text-white/90 hover:text-white dark:text-foreground dark:hover:text-primary transition-colors"
                  >
                    <span className="text-white/60 dark:text-muted">
                      {t("common.balance")}:
                    </span>
                    <span className="font-bold text-white dark:text-up mono">
                      {(session.user as any)?.balance?.toLocaleString() || 0} P
                    </span>
                  </Link>
                  <div className="h-4 w-px bg-white/20 dark:bg-border-exchange" />
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => signOut()}
                      className="text-sm text-white/60 hover:text-white dark:text-muted dark:hover:text-down transition-colors"
                    >
                      {t("common.logout")}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center space-x-4">
                  <Link
                    href="/auth/signin"
                    className="text-sm font-medium text-white hover:text-white/80 dark:text-foreground dark:hover:text-primary"
                  >
                    {t("common.login")}
                  </Link>
                </div>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="text-white dark:text-foreground p-2"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  {isMenuOpen ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16m-7 6h7"
                    />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden pb-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <Link
              href="/creators"
              className="block text-white/90 dark:text-foreground hover:text-white dark:hover:text-primary py-2"
            >
              {t("common.creators")}
            </Link>
            <Link
              href="/dashboard"
              className="block text-white/90 dark:text-foreground hover:text-white dark:hover:text-primary py-2"
            >
              {t("common.dashboard")}
            </Link>
            {status === "authenticated" ? (
              <div className="space-y-4 pt-4 border-t border-white/10 dark:border-border-exchange">
                <div className="block text-white dark:text-foreground font-bold">
                  {t("common.balance")}:{" "}
                  {(session.user as any)?.balance?.toLocaleString()} P
                </div>
                <button
                  onClick={() => signOut()}
                  className="block text-white/60 dark:text-muted w-full text-left"
                >
                  {t("common.logout")}
                </button>
              </div>
            ) : (
              <Link
                href="/auth/signin"
                className="block bg-white dark:bg-primary text-brand-blue dark:text-background text-center py-3 rounded-xl font-bold"
              >
                {t("common.login")}
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
