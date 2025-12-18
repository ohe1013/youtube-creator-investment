"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface MarketChartProps {
  data: Array<{
    date: string;
    price: number;
    volume?: number;
  }>;
}

export function MarketChart({ data }: MarketChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#161a1e] text-[#848e9c]">
        Loading Chart...
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#161a1e] relative min-h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#2b3139" strokeDasharray="3 3" vertical={false} />
          <XAxis 
            dataKey="date" 
            stroke="#848e9c" 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="#848e9c" 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
            domain={['auto', 'auto']}
            orientation="right"
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e2329', border: '1px solid #2b3139', borderRadius: '4px' }}
            itemStyle={{ color: '#fcd535' }}
            labelStyle={{ color: '#848e9c' }}
          />
          <Line 
            type="monotone" 
            dataKey="price" 
            stroke="#c84a31" 
            strokeWidth={2} 
            dot={false}
            activeDot={{ r: 4, stroke: '#fff' }}
            animationDuration={500}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
