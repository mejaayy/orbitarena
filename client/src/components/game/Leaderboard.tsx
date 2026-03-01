import React from 'react';
import { Card } from '@/components/ui/card';

interface LeaderboardProps {
  players: any[];
  localPlayerId: string | null;
  timeRemaining?: number;
  isStakeMode?: boolean;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ players, localPlayerId, timeRemaining, isStakeMode }) => {
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

  // Calculate your rank (1-indexed) and get your mass
  const localPlayer = players.find(p => p.id === localPlayerId);
  const yourRank = players.findIndex(p => p.id === localPlayerId) + 1;
  const yourMass = localPlayer ? Math.floor(localPlayer.score) : 0;
  const aliveCount = players.filter(p => !p.isSpectator).length;
  const sortedPlayers = [...players]
    .filter(p => !p.isSpectator)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  return (
    <Card className="absolute top-[180px] left-4 w-48 bg-black/40 backdrop-blur-md border-white/5 p-3 text-white pointer-events-none select-none">
      <div className="space-y-2 text-sm font-medium">
        <div className="flex justify-between items-center border-b border-white/10 pb-1 mb-1">
          <span className="text-gray-400">Leaderboard</span>
          <span className="text-lime-400 font-bold">{aliveCount} Alive</span>
        </div>
        
        <div className="space-y-1">
          {sortedPlayers.map((p, i) => (
            <div key={p.id} className="flex justify-between items-center text-[11px]">
              <div className="flex items-center gap-1 overflow-hidden">
                <span className={`${getRankColor(i + 1)} w-4 shrink-0`}>{i + 1}.</span>
                <span className={`truncate ${p.id === localPlayerId ? 'text-white font-bold' : 'text-gray-300'}`}>
                  {p.name}{p.isBot ? ' [BOT]' : ''}
                </span>
              </div>
              <span className="text-gray-400 shrink-0 ml-1">{Math.floor(p.score)}</span>
            </div>
          ))}
        </div>

        <div className="pt-1 mt-1 border-t border-white/10 flex justify-between items-center text-[11px]">
          <span className="text-gray-400">Your Rank:</span>
          <span className={`${getRankColor(yourRank)} font-bold`}>#{yourRank || '--'}</span>
        </div>
        
        {isStakeMode && (
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-gray-400">Time left:</span>
            <span className="text-cyan-400 font-bold">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
