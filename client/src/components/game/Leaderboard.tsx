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
    <Card className="absolute top-4 right-4 w-48 bg-black/50 backdrop-blur-md border-white/10 p-4 text-white pointer-events-none select-none">
      <h3 className="font-bold text-sm text-gray-400 mb-2 uppercase tracking-wider">Leaderboard</h3>
      <ul className="space-y-1 text-sm font-medium">
        {players.slice(0, 5).map((p, i) => (
          <li key={p.id} className="flex justify-between items-center">
            <span className={i === 0 ? "text-yellow-400" : "text-gray-200"}>
              {i+1}. {p.name}
            </span>
            <span className="text-gray-500">{Math.floor(p.score)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};
