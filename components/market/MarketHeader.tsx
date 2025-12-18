"use client";

import { useMemo } from "react";

interface MarketHeaderProps {
  creator: {
    name: string;
    currentPrice: number;
    currentSubs: number;
    currentViews: number;
    liquidity: number;
  } | null;
  stats?: {
    high24h: number;
    low24h: number;
    vol24h: number;
    change24h: number;
  };
}

export function MarketHeader({ creator, stats }: MarketHeaderProps) {
  if (!creator) return <div className="h-20 bg-[#12161c] border-b border-[#2b3139]" />;

  const changeColor = (stats?.change24h || 0) >= 0 ? "text-[#c84a31]" : "text-[#1261c4]"; // Upbit Red/Blue
  const changeSign = (stats?.change24h || 0) >= 0 ? "+" : "";

  return (
    <div className="h-24 bg-[#12161c] border-b border-[#2b3139] flex items-center px-6 justify-between">
      <div className="flex items-center gap-4">
         <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-white font-bold text-lg">
            {creator.name.substring(0, 1)}
         </div>
         <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
               {creator.name}
               <span className="text-xs text-[#848e9c] font-normal bg-[#2b3139] px-2 py-0.5 rounded">YOUTUBE</span>
            </h1>
            <div className="flex items-end gap-2 text-2xl font-mono font-bold text-white">
               {creator.currentPrice.toLocaleString()} P
               <span className={`text-sm mb-1 ${changeColor}`}>
                  {changeSign}{(stats?.change24h || 0).toFixed(2)}%
               </span>
            </div>
         </div>
      </div>

      <div className="flex gap-8 text-xs">
          <div className="flex flex-col gap-1">
             <span className="text-[#848e9c]">24h High</span>
             <span className="font-mono text-white">{(stats?.high24h || creator.currentPrice).toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[#848e9c]">24h Low</span>
             <span className="font-mono text-white">{(stats?.low24h || creator.currentPrice).toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[#848e9c]">24h Volume</span>
             <span className="font-mono text-white">{(stats?.vol24h || 0).toLocaleString()}</span>
          </div>
          <div className="flex flex-col gap-1">
             <span className="text-[#848e9c]">Liquidity</span>
             <span className="font-mono text-white">{creator.liquidity.toLocaleString()}</span>
          </div>
      </div>
    </div>
  );
}
