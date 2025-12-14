import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { GameCanvas } from '@/components/game/GameCanvas';
import { Joystick } from '@/components/game/Joystick';
import { Leaderboard } from '@/components/game/Leaderboard';
import { GameEngine } from '@/game/GameEngine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Home, RotateCcw } from 'lucide-react';

export default function Game() {
  const [location, setLocation] = useLocation();
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [stats, setStats] = useState({ fps: 60, population: 0 });
  const [gameOverStats, setGameOverStats] = useState<{ score: number, killer?: string } | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  // Parse query params manually since wouter doesn't have a hook for it built-in easily
  const searchParams = new URLSearchParams(window.location.search);
  const playerName = searchParams.get('name') || 'Unknown';
  const isStakeMode = searchParams.get('stake') === 'true';

  useEffect(() => {
    // Leaderboard Polling
    const interval = setInterval(() => {
      if (engine) {
        const players = Array.from(engine.players.values())
          .sort((a, b) => b.score - a.score)
          .map(p => ({ id: p.id, name: p.name, score: p.score }));
        setLeaderboard(players);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [engine]);

  const handleGameOver = (stats: { score: number, killer?: string }) => {
    setGameOverStats(stats);
  };

  const handleRestart = () => {
    setGameOverStats(null);
    engine?.start(playerName, isStakeMode);
  };

  const handleExit = () => {
    setLocation('/');
  };

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      <GameCanvas 
        playerName={playerName}
        isStakeMode={isStakeMode}
        onGameOver={handleGameOver}
        onUpdateStats={setStats}
        onEngineInit={setEngine}
      />
      
      {/* UI Overlay */}
      <div className="absolute top-4 left-4 text-white/50 text-xs font-mono space-y-1 pointer-events-none">
        <div>FPS: {stats.fps}</div>
        <div>PLAYERS: {stats.population}</div>
        <div>MODE: {isStakeMode ? 'STAKE (0.1 SOL)' : 'FREE PLAY'}</div>
      </div>

      <Leaderboard players={leaderboard} />
      <Joystick engine={engine} />

      {/* Game Over Dialog */}
      <Dialog open={!!gameOverStats} onOpenChange={() => {}}>
        <DialogContent className="bg-card/90 backdrop-blur-xl border-white/10 sm:max-w-md">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-destructive/20 rounded-full flex items-center justify-center mb-4 text-destructive">
              <Trophy className="w-6 h-6" />
            </div>
            <DialogTitle className="text-3xl font-black uppercase">Eliminated</DialogTitle>
            <DialogDescription className="text-lg text-gray-300">
              You were eaten by <span className="font-bold text-white">{gameOverStats?.killer || 'Unknown'}</span>
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-6 text-center space-y-2">
            <div className="text-sm uppercase tracking-widest text-gray-500">Final Score</div>
            <div className="text-5xl font-mono font-bold text-primary">{Math.floor(gameOverStats?.score || 0)}</div>
          </div>

          <DialogFooter className="sm:justify-center gap-2">
            <Button variant="outline" onClick={handleExit} className="gap-2">
              <Home className="w-4 h-4" /> Exit
            </Button>
            <Button onClick={handleRestart} className="gap-2 bg-primary hover:bg-primary/90 text-white">
              <RotateCcw className="w-4 h-4" /> Play Again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
