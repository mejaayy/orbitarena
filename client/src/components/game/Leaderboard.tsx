import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

interface LeaderboardProps {
  players: any[]; // Simplified for now
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ players }) => {
  // Mock data or real data from engine
  // Since engine runs on animation loop and React on state, we might need to sync
  // For prototype, we can poll engine or pass data via onUpdateStats
  
  return (
    <Card className="absolute top-4 right-4 w-40 bg-black/40 backdrop-blur-md border-white/5 p-2 text-white pointer-events-none select-none">
      <h3 className="font-bold text-[10px] text-gray-500 mb-1 uppercase tracking-wider">Leaderboard</h3>
      <ul className="space-y-0.5 text-xs font-medium">
        {players.slice(0, 5).map((p, i) => (
          <li key={p.id} className="flex justify-between items-center">
            <span className={`truncate max-w-[80px] ${i === 0 ? "text-yellow-400" : "text-gray-300"}`}>
              {i+1}. {p.name}
            </span>
            <span className="text-gray-600 text-[10px]">{Math.floor(p.score)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};
