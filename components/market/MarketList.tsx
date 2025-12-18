"use client";

import Link from "next/link";

interface MarketListProps {
  creators: Array<{
    id: string;
    name: string;
    currentPrice: number;
    change24h?: number;
    volume24h?: number;
  }>;
  selectedId?: string;
}

export function MarketList({ creators, selectedId }: MarketListProps) {
  return (
    <div className="w-[300px] flex flex-col bg-[#12161c]">
      <div className="h-12 border-b border-[#2b3139] flex items-center px-4">
        <input 
          type="text" 
          placeholder="Search..."
          className="w-full bg-[#1e2329] border-none rounded px-3 py-1.5 text-xs text-white focus:ring-1 ring-[#fcd535]"
        />
      </div>
      
      <div className="flex text-[10px] text-[#848e9c] px-4 py-2 bg-[#161a1e]">
         <span className="flex-1">Name</span>
         <span className="w-16 text-right">Price</span>
         <span className="w-14 text-right">Chg%</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {creators.map((c) => {
           const isSelected = c.id === selectedId;
           const changeColor = (c.change24h || 0) >= 0 ? "text-[#c84a31]" : "text-[#1261c4]";
           
           return (
             <Link 
               key={c.id} 
               href={`/?ticker=${c.id}`}
               className={`flex items-center px-4 py-2 hover:bg-[#2b3139] cursor-pointer transition-colors ${isSelected ? 'bg-[#2b3139]' : ''}`}
             >
                <div className="flex-1 flex flex-col">
                   <span className="text-xs font-bold text-white text-ellipsis overflow-hidden whitespace-nowrap">{c.name}</span>
                   <span className="text-[10px] text-[#5d6673]">{c.volume24h ? `Vol ${c.volume24h}` : ''}</span>
                </div>
                <div className="w-16 text-right text-xs font-mono text-white">
                   {c.currentPrice.toLocaleString()}
                </div>
                <div className={`w-14 text-right text-xs font-bold ${changeColor}`}>
                   {(c.change24h || 0).toFixed(1)}%
                </div>
             </Link>
           );
        })}
      </div>
    </div>
  );
}
