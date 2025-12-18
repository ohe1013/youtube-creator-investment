"use client";

import { useState } from "react";

interface OrderFormProps {
  creatorId: string;
  currentPrice: number;
  userBalance: number;
  userQuantity: number; // User's holding of this creator
  onBuy: (amount: number) => Promise<void>;
  onSell: (amount: number) => Promise<void>;
}

export function OrderForm({ creatorId, currentPrice, userBalance, userQuantity, onBuy, onSell }: OrderFormProps) {
  const [tab, setTab] = useState<'BUY' | 'SELL'>('BUY');
  const [amount, setAmount] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const price = currentPrice;
  const quantity = parseFloat(amount) || 0;
  const total = quantity * price;

  const handleSubmit = async () => {
    if (loading || quantity <= 0) return;
    setLoading(true);
    try {
      if (tab === 'BUY') {
        await onBuy(quantity);
      } else {
        await onSell(quantity);
      }
      setAmount('');
    } catch (e) {
      console.error(e);
      alert("Trade Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-[#161a1e] flex flex-col">
      <div className="flex border-b border-[#2b3139]">
        <button 
           onClick={() => setTab('BUY')}
           className={`flex-1 py-3 font-bold text-sm ${tab === 'BUY' ? 'text-[#c84a31] border-b-2 border-[#c84a31] bg-[#c84a31]/10' : 'text-[#848e9c]'}`}
        >
          BUY
        </button>
        <button 
           onClick={() => setTab('SELL')}
           className={`flex-1 py-3 font-bold text-sm ${tab === 'SELL' ? 'text-[#1261c4] border-b-2 border-[#1261c4] bg-[#1261c4]/10' : 'text-[#848e9c]'}`}
        >
          SELL
        </button>
      </div>

      <div className="p-4 flex flex-col gap-4 flex-1 overflow-auto">
         <div className="flex justify-between text-xs text-[#848e9c]">
            <span>Available</span>
            <span className="text-white font-mono">
              {tab === 'BUY' ? `${userBalance.toLocaleString()} P` : `${userQuantity} Shares`}
            </span>
         </div>

         <div className="flex flex-col gap-2">
            <label className="text-xs text-[#848e9c]">Order Type</label>
            <div className="bg-[#2b3139] px-3 py-2 rounded text-sm text-white font-bold cursor-not-allowed opacity-50">
               Market Price
            </div>
         </div>

         <div className="flex flex-col gap-2">
            <label className="text-xs text-[#848e9c]">Price</label>
            <div className="bg-[#2b3139] px-3 py-2 rounded text-sm text-white font-mono flex justify-between">
               <span>{price.toLocaleString()}</span>
               <span className="text-[#848e9c]">P</span>
            </div>
         </div>

         <div className="flex flex-col gap-2">
            <label className="text-xs text-[#848e9c]">Quantity</label>
            <div className="relative">
              <input 
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-[#1e2329] border border-[#2b3139] rounded px-3 py-2 text-white font-mono focus:border-[#fcd535] outline-none"
              />
            </div>
         </div>

         {/* Percent Buttons */}
         <div className="grid grid-cols-4 gap-2">
            {[0.1, 0.25, 0.5, 1].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  if (tab === 'BUY') {
                    // Max buyable
                    const maxQty = Math.floor(userBalance / price);
                    setAmount(Math.floor(maxQty * pct).toString());
                  } else {
                    setAmount(Math.floor(userQuantity * pct).toString());
                  }
                }}
                className="bg-[#2b3139] hover:bg-[#343a41] text-xs text-[#848e9c] rounded py-1"
              >
                {pct * 100}%
              </button>
            ))}
         </div>

         <div className="mt-4 pt-4 border-t border-[#2b3139]">
            <div className="flex justify-between text-xs mb-2">
               <span className="text-[#848e9c]">Total</span>
               <span className="text-white font-mono">{total.toLocaleString()} P</span>
            </div>
            <button
               onClick={async () => {
                 if (loading || total <= 0) return;
                 setLoading(true);
                 try {
                   const endpoint = tab === 'BUY' ? '/api/trade/buy' : '/api/trade/sell';
                   const res = await fetch(endpoint, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ creatorId, quantity: parseFloat(amount) })
                   });
                   const data = await res.json();
                   
                   if (!res.ok) throw new Error(data.error || 'Trade Failed');
                   
                   alert(`Success: ${data.message || 'Trade executed'}`);
                   setAmount('');
                   // Ideally refresh page or invalidate queries
                   window.location.reload(); 
                 } catch (e) {
                   console.error(e);
                   alert(e instanceof Error ? e.message : "Trade Failed");
                 } finally {
                   setLoading(false);
                 }
               }}
               disabled={loading || total <= 0}
               className={`w-full py-3 rounded font-bold text-white transition-opacity ${
                 loading ? 'opacity-50' : ''
               } ${
                 tab === 'BUY' ? 'bg-[#c84a31] hover:bg-[#c84a31]/90' : 'bg-[#1261c4] hover:bg-[#1261c4]/90'
               }`}
            >
               {loading ? 'Processing...' : tab}
            </button>
         </div>
      </div>
    </div>
  );
}
