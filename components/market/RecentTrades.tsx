"use client";

interface RecentTradesProps {
  trades: Array<{
    id: string;
    price: number;
    quantity: number;
    time: string;
    type: 'BUY' | 'SELL';
  }>;
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <div className="flex-1 bg-[#161a1e] border-t border-[#2b3139] flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-[#2b3139] text-xs font-bold text-white">
        Recent Trades
      </div>
      <div className="flex px-4 py-1 text-[10px] text-[#848e9c]">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-right">Qty</span>
        <span className="flex-1 text-right">Time</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {trades.map((t) => (
          <div key={t.id} className="flex px-4 py-1 text-xs hover:bg-[#1e2329]">
            <span className={`flex-1 font-mono ${t.type === 'BUY' ? 'text-[#c84a31]' : 'text-[#1261c4]'}`}>
              {t.price.toLocaleString()}
            </span>
            <span className="flex-1 text-right font-mono text-white">
              {t.quantity.toLocaleString()}
            </span>
            <span className="flex-1 text-right text-[#848e9c] font-mono">
              {t.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
