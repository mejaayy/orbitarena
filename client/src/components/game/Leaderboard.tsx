import React from 'react';
import { Card } from '@/components/ui/card';

interface LeaderboardProps {
  players: any[];
  localPlayerId: string | null;
  timeRemaining?: number;
  isStakeMode?: boolean;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ players, localPlayerId, timeRemaining, isStakeMode }) => {
  // Calculate your rank (1-indexed) and get your mass
  const localPlayer = players.find(p => p.id === localPlayerId);
  const yourRank = players.findIndex(p => p.id === localPlayerId) + 1;
  const yourMass = localPlayer ? Math.floor(localPlayer.score) : 0;
  const aliveCount = players.length;
  
  // Get rank color: gold for 1st, silver for 2nd, bronze for 3rd
  const getRankColor = (rank: number) => {
    if (rank === 1) return 'text-yellow-400'; // Gold
    if (rank === 2) return 'text-gray-300'; // Silver
    if (rank === 3) return 'text-amber-600'; // Bronze
    return 'text-white';
  };
  
  // Format time remaining
  const formatTime = (ms?: number) => {
    if (ms === undefined || ms <= 0) return '--:--';
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  return (
    <Card className="absolute top-[180px] left-4 w-36 bg-black/40 backdrop-blur-md border-white/5 p-3 text-white pointer-events-none select-none">
      <div className="space-y-2 text-sm font-medium">
        <div className="flex justify-between items-center">
          <span className="text-gray-400">You:</span>
          <span className={`${getRankColor(yourRank)} font-bold`}>#{yourRank || '--'} ({yourMass})</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-gray-400">Alive:</span>
          <span className="text-lime-400 font-bold">{aliveCount}</span>
        </div>
        {isStakeMode && (
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Time left:</span>
            <span className="text-cyan-400 font-bold">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
