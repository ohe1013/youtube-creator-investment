"use client";

import { useState } from "react";
import { MarketHeader } from "./MarketHeader";
import { MarketChart } from "./MarketChart";
import { OrderForm } from "./OrderForm";
import { RecentTrades } from "./RecentTrades";
import { MarketList } from "./MarketList";
import { CreatorInfo } from "./CreatorInfo";

interface MarketDashboardProps {
  selectedCreator: any;
  stats: any;
  chartData: any[];
  trades: any[];
  creators: any[];
  userBalance: number;
  userQuantity: number;
}

export function MarketDashboard({
  selectedCreator,
  stats,
  chartData,
  trades,
  creators,
  userBalance,
  userQuantity
}: MarketDashboardProps) {
  // Mobile Tab State: 'CHART' | 'ORDER' | 'TRADES' | 'LIST'
  const [mobileTab, setMobileTab] = useState<'CHART' | 'ORDER' | 'TRADES' | 'LIST'>('CHART');
  
  // Desktop/Inner Chart Tab State: 'CHART' | 'INFO'
  const [chartTab, setChartTab] = useState<'CHART' | 'INFO'>('CHART');

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Header - Always Visible */}
      <MarketHeader creator={selectedCreator} stats={stats} />

      {/* Mobile Navigation Tabs (Visible only on mobile) */}
      <div className="md:hidden flex h-10 border-b border-[#2b3139] bg-[#161a1e] text-xs font-bold">
        {['CHART', 'ORDER', 'TRADES', 'LIST'].map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab as any)}
            className={`flex-1 ${mobileTab === tab ? 'text-[#fcd535] border-b-2 border-[#fcd535]' : 'text-[#848e9c]'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 relative">
        
        {/* --- LEFT SIDE (Desktop) / DYNAMIC (Mobile) --- */}
        <div className={`flex-1 flex flex-col min-w-0 border-r border-[#2b3139] md:flex ${mobileTab === 'LIST' ? 'hidden' : 'flex'}`}>
           
           {/* Chart Section */}
           <div className={`flex-col relative ${mobileTab === 'CHART' || 'hidden md:flex flex-1 min-h-0'}`}>
              {/* Chart Tabs (Chart vs Info) */}
              <div className="absolute top-2 left-2 z-10 flex gap-2">
                 <button 
                   onClick={() => setChartTab('CHART')}
                   className={`px-3 py-1 rounded text-xs font-bold transition-colors ${chartTab === 'CHART' ? 'bg-[#2b3139] text-white shadow-sm' : 'text-[#848e9c] hover:bg-[#2b3139]/50'}`}
                 >
                   Chart
                 </button>
                 <button 
                   onClick={() => setChartTab('INFO')}
                   className={`px-3 py-1 rounded text-xs font-bold transition-colors ${chartTab === 'INFO' ? 'bg-[#2b3139] text-white shadow-sm' : 'text-[#848e9c] hover:bg-[#2b3139]/50'}`}
                 >
                   Info
                 </button>
              </div>

              {/* Chart Content Area */}
              <div className="flex-1 bg-[#161a1e] flex flex-col min-h-[300px] md:min-h-0 md:h-[60%]">
                 {chartTab === 'CHART' ? (
                    <MarketChart data={chartData} />
                 ) : (
                    <CreatorInfo creator={selectedCreator} />
                 )}
              </div>
           </div>

           {/* Order & Trades Section */}
           <div className={`flex-1 md:h-[40%] md:flex border-t border-[#2b3139] ${
             mobileTab === 'ORDER' || mobileTab === 'TRADES' ? 'flex flex-col' : 'hidden md:flex'
           }`}>
              {/* Order Form */}
              <div className={`w-full md:w-[320px] md:border-r border-[#2b3139] ${mobileTab === 'ORDER' || 'hidden md:block'}`}>
                 <OrderForm 
                    creatorId={selectedCreator.id}
                    currentPrice={selectedCreator.currentPrice}
                    userBalance={userBalance}
                    userQuantity={userQuantity}
                    onBuy={async (amt) => {
                       await fetch('/api/trade/buy', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ creatorId: selectedCreator.id, quantity: amt })
                       }).then(async r => {
                          if (!r.ok) throw new Error((await r.json()).error);
                          window.location.reload();
                       });
                    }}
                    onSell={async (amt) => {
                       await fetch('/api/trade/sell', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ creatorId: selectedCreator.id, quantity: amt })
                       }).then(async r => {
                          if (!r.ok) throw new Error((await r.json()).error);
                          window.location.reload();
                       });
                    }}
                 />
              </div>

              {/* Recent Trades */}
              <div className={`flex-1 flex flex-col ${mobileTab === 'TRADES' || 'hidden md:flex'}`}>
                 <RecentTrades trades={trades} />
              </div>
           </div>
        </div>

        {/* --- RIGHT SIDE (Market List) --- */}
        <div className={`w-full md:w-[300px] bg-[#12161c] ${mobileTab === 'LIST' ? 'flex flex-col z-20 absolute inset-0 md:static' : 'hidden md:flex flex-col'}`}>
           <MarketList creators={creators} selectedId={selectedCreator.id} />
        </div>

      </div>
    </div>
  );
}
