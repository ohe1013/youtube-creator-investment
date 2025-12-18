"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export default function Home() {
  const { data: session, status } = useSession();

  return (
    <main className="min-h-screen bg-[#0b0e11] text-[#eaecef]">
      <div className="container mx-auto px-4 py-20 lg:py-32">
        {/* Hero Section */}
        <div className="text-center mb-24 max-w-4xl mx-auto">
          <div className="inline-block px-4 py-1.5 bg-[#fcd535]/10 rounded-full mb-6 border border-[#fcd535]/20">
            <span className="text-[#fcd535] text-xs font-bold tracking-widest uppercase">
              The Next-Gen Creator Exchange
            </span>
          </div>
          <h1 className="text-5xl lg:text-7xl font-black text-white mb-8 tracking-tighter leading-tight">
            Invest in the <br />
            <span className="text-[#fcd535]">Next Million</span> Subscribed.
          </h1>
          <p className="text-lg lg:text-xl text-[#848e9c] mb-12 max-w-2xl mx-auto leading-relaxed">
            CREATORX is a high-performance virtual trading platform where you
            can discover rising YouTube stars and trade their growth potential
            in real-time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/creators"
              className="px-10 py-4 bg-[#fcd535] hover:bg-[#fcd535]/90 text-[#12161c] rounded font-bold text-lg transition-all"
            >
              Start Trading
            </Link>
            {status === "authenticated" ? (
              <Link
                href="/portfolio"
                className="px-10 py-4 bg-[#2b3139] hover:bg-[#343a41] text-white rounded font-bold text-lg transition-all border border-white/5"
              >
                My Portfolio
              </Link>
            ) : (
              <Link
                href="/auth/signin"
                className="px-10 py-4 bg-[#1e2329] hover:bg-[#2b3139] text-white rounded font-bold text-lg transition-all border border-[#2b3139]"
              >
                Sign Up Now
              </Link>
            )}
          </div>
        </div>

        {/* Live Market Snapshot Simulated */}
        <div className="mb-32 bg-[#161a1e] border border-[#2b3139] rounded-xl overflow-hidden shadow-2xl">
          <div className="px-6 py-4 flex justify-between items-center border-b border-[#2b3139]">
            <span className="text-xs font-bold text-[#848e9c]">
              MARKET HOT LIST
            </span>
            <Link href="/creators" className="text-xs text-[#fcd535] font-bold">
              View More Market →
            </Link>
          </div>
          <div className="grid md:grid-cols-4 divide-x divide-[#2b3139]">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="p-6 hover:bg-[#1e2329] transition-colors cursor-pointer"
              >
                <div className="text-[10px] text-[#848e9c] uppercase mb-1">
                  Top Gainer {i + 1}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#fcd535] to-[#f6465d]" />
                  <span className="font-bold text-white text-sm">
                    CHANNEL_{i}
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-xl font-bold mono">
                    {(Math.random() * 5000 + 1000).toFixed(0)} P
                  </span>
                  <span className="text-xs font-bold text-[#0ecb81] mb-1">
                    +{(Math.random() * 15).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="grid lg:grid-cols-3 gap-8 mb-32">
          <div className="p-8 border border-[#2b3139] rounded-xl hover:border-[#fcd535]/50 transition-colors bg-[#12161c]">
            <div className="w-12 h-12 bg-[#fcd535]/10 rounded-lg flex items-center justify-center text-2xl mb-6">
              📊
            </div>
            <h3 className="text-xl font-black text-white mb-4">
              Market Analytics
            </h3>
            <p className="text-[#848e9c] text-sm leading-relaxed">
              Real-time synchronization with YouTube Data API. Track
              subscribers, view counts, and upload consistency with
              institutional-grade precision.
            </p>
          </div>

          <div className="p-8 border border-[#2b3139] rounded-xl hover:border-[#fcd535]/50 transition-colors bg-[#12161c]">
            <div className="w-12 h-12 bg-[#0ecb81]/10 rounded-lg flex items-center justify-center text-2xl mb-6">
              ⚡
            </div>
            <h3 className="text-xl font-black text-white mb-4">
              Instant Execution
            </h3>
            <p className="text-[#848e9c] text-sm leading-relaxed">
              Experience zero-latency virtual trading. Execute buy and sell
              orders instantly as market trends shift in the creator economy.
            </p>
          </div>

          <div className="p-8 border border-[#2b3139] rounded-xl hover:border-[#fcd535]/50 transition-colors bg-[#12161c]">
            <div className="w-12 h-12 bg-[#5d6673]/10 rounded-lg flex items-center justify-center text-2xl mb-6">
              🛡️
            </div>
            <h3 className="text-xl font-black text-white mb-4">
              Risk-Free Investing
            </h3>
            <p className="text-[#848e9c] text-sm leading-relaxed">
              Master the market with 100,000 complimentary virtual units. Build
              your portfolio strategy without risking real capital.
            </p>
          </div>
        </div>

        {/* CTA Footer */}
        <div className="text-center border-t border-[#2b3139] pt-20">
          <h2 className="text-3xl font-black text-white mb-6 italic tracking-tight">
            ELEVATE YOUR PORTFOLIO.
          </h2>
          <Link
            href="/auth/signin"
            className="inline-block px-12 py-5 bg-[#fcd535] text-black font-black rounded hover:transform hover:scale-105 transition-all shadow-[0_0_30px_rgba(252,213,53,0.3)]"
          >
            JOIN THE EXCHANGE
          </Link>
          <div className="mt-20 text-[#2b5d6e] text-[10px] font-mono tracking-[0.5em] uppercase">
            Designed for professional creator scouts
          </div>
        </div>
      </div>
    </main>
  );
}
