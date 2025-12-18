"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="bg-[#12161c] border-b border-[#2b3139] sticky top-0 z-50">
      <div className="container mx-auto px-4 lg:px-6">
        <div className="flex justify-between items-center h-14">
          {/* Logo and Primary Nav */}
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-xl font-black tracking-tighter text-[#fcd535]">
                CREATOR<span className="text-white">X</span>
              </span>
            </Link>

            <div className="hidden md:flex items-center space-x-6">
              <Link
                href="/creators"
                className="text-sm font-medium text-[#eaecef] hover:text-[#fcd535] transition-colors"
              >
                Market
              </Link>
              <Link
                href="/rankings"
                className="text-sm font-medium text-[#eaecef] hover:text-[#fcd535] transition-colors"
              >
                Leaderboard
              </Link>
            </div>
          </div>

          {/* User Actions */}
          <div className="hidden md:flex items-center space-x-6">
            {status === "authenticated" ? (
              <>
                <Link
                  href="/portfolio"
                  className="flex items-center space-x-2 text-sm text-[#eaecef] hover:text-[#fcd535] transition-colors"
                >
                  <span className="text-[#848e9c]">Balance:</span>
                  <span className="font-bold text-[#0ecb81] mono">
                    {(session.user as any)?.balance?.toLocaleString() || 0} P
                  </span>
                </Link>
                <div className="h-4 w-px bg-[#2b3139]" />
                <div className="flex items-center space-x-4">
                  <Link
                    href="/portfolio"
                    className="text-sm text-[#eaecef] hover:text-[#fcd535]"
                  >
                    Portfolio
                  </Link>
                  <button
                    onClick={() => signOut()}
                    className="text-sm text-[#848e9c] hover:text-[#f6465d] transition-colors"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-4">
                <Link
                  href="/auth/signin"
                  className="text-sm font-medium text-[#eaecef] hover:text-[#fcd535]"
                >
                  Log In
                </Link>
                <Link
                  href="/auth/signin"
                  className="bg-[#fcd535] hover:bg-[#fcd535]/90 text-[#12161c] px-4 py-1.5 rounded text-sm font-bold transition-colors"
                >
                  Register
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="text-white p-2"
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

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="md:hidden pb-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
            <Link
              href="/creators"
              className="block text-blue-100 hover:text-white py-2"
            >
              크리에이터 둘러보기
            </Link>
            <Link
              href="/rankings"
              className="block text-blue-100 hover:text-white py-2"
            >
              리더보드
            </Link>
            {status === "authenticated" ? (
              <div className="space-y-4 pt-4 border-t border-white/10">
                <Link href="/portfolio" className="block text-white font-bold">
                  내 포트폴리오 (
                  {(session.user as any)?.balance?.toLocaleString()} P)
                </Link>
                <button
                  onClick={() => signOut()}
                  className="block text-blue-300 w-full text-left"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <Link
                href="/auth/signin"
                className="block bg-purple-600 text-white text-center py-3 rounded-xl font-bold"
              >
                시작하기
              </Link>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
