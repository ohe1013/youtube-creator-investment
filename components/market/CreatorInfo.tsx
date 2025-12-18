"use client";

import Link from "next/link";

interface CreatorInfoProps {
  creator: {
    id: string;
    name: string;
    description?: string;
    currentSubs: number;
    currentViews: number;
    channelId?: string; // If available in schema
  };
}

export function CreatorInfo({ creator }: CreatorInfoProps) {
  return (
    <div className="flex-1 bg-[#161a1e] p-6 text-[#eaecef] overflow-y-auto">
      <div className="flex items-center gap-4 mb-6">
         <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-2xl font-bold text-white">
            {creator.name.substring(0, 1)}
         </div>
         <div>
            <h2 className="text-2xl font-bold">{creator.name}</h2>
            <div className="flex gap-2 text-sm text-[#848e9c] mt-1">
               <span>Subscribers {creator.currentSubs.toLocaleString()}</span>
               <span>•</span>
               <span>Total Views {creator.currentViews.toLocaleString()}</span>
            </div>
         </div>
      </div>

      <div className="space-y-6">
         <div className="bg-[#1e2329] p-4 rounded">
            <h3 className="text-sm font-bold text-[#848e9c] mb-2">Description</h3>
            <p className="text-sm leading-relaxed">
              {creator.description || "No description available for this creator."}
            </p>
         </div>

         <div className="grid grid-cols-2 gap-4">
             <div className="bg-[#1e2329] p-4 rounded">
                <span className="text-xs text-[#848e9c] block mb-1">Market Cap</span>
                <span className="font-mono text-lg">{(creator.currentSubs * 100).toLocaleString()} P</span>
             </div>
             <div className="bg-[#1e2329] p-4 rounded">
                <span className="text-xs text-[#848e9c] block mb-1">Rank</span>
                <span className="font-mono text-lg">#1</span>
             </div>
         </div>
         
         <div className="pt-4 border-t border-[#2b3139]">
            <Link 
              href={`https://youtube.com/channel/${creator.channelId || ''}`} 
              target="_blank"
              className="inline-flex items-center gap-2 text-[#fcd535] hover:text-[#fcd535]/80 transition-colors"
            >
               <span>Visit YouTube Channel</span>
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </Link>
         </div>
      </div>
    </div>
  );
}
