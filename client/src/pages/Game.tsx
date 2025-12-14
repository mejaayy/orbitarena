import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { GameCanvas } from '@/components/game/GameCanvas';
import { Joystick } from '@/components/game/Joystick';
import { Leaderboard } from '@/components/game/Leaderboard';
import { GameEngine } from '@/game/GameEngine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Home, RotateCcw, LogOut, Coins, AlertCircle } from 'lucide-react';
import { EXIT_FEE_PERCENT } from '@/lib/phantom';

export default function Game() {
  const [location, setLocation] = useLocation();
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [stats, setStats] = useState({ fps: 60, population: 0, balance: 1 });
  const [gameOverStats, setGameOverStats] = useState<{ score: number, killer?: string, balance?: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isHoldingLeave, setIsHoldingLeave] = useState(false);
  const [leaveProgress, setLeaveProgress] = useState(0);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leaveStartRef = useRef<number>(0);

  const searchParams = new URLSearchParams(window.location.search);
  const playerName = searchParams.get('name') || 'Unknown';
  const isStakeMode = searchParams.get('stake') === 'true';
  const walletAddress = searchParams.get('wallet') || undefined;

  useEffect(() => {
    const interval = setInterval(() => {
      if (engine) {
        const players = Array.from(engine.players.values())
          .sort((a, b) => b.score - a.score)
          .map(p => ({ id: p.id, name: p.name, score: p.score, balance: p.balance }));
        setLeaderboard(players);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [engine]);

  const handleGameOver = (stats: { score: number, killer?: string, balance?: number }) => {
    setGameOverStats(stats);
  };

  const handleRestart = () => {
    setGameOverStats(null);
    engine?.start(playerName, isStakeMode, walletAddress);
  };

  const handleExit = () => {
    setLocation('/');
  };

  const handleLeaveStart = useCallback(() => {
    setIsHoldingLeave(true);
    setLeaveError(null);
    leaveStartRef.current = Date.now();
    
    leaveTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - leaveStartRef.current;
      const progress = Math.min(elapsed / 3000, 1);
      setLeaveProgress(progress);
      
      if (progress >= 1) {
        if (leaveTimerRef.current) {
          clearInterval(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
        
        const success = engine?.sendLeave();
        if (success) {
          setLocation('/');
        } else {
          setLeaveError('Cannot leave during combat');
          setLeaveProgress(0);
          setIsHoldingLeave(false);
        }
      }
    }, 50);
  }, [engine, setLocation]);

  const handleLeaveEnd = useCallback(() => {
    if (leaveTimerRef.current) {
      clearInterval(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHoldingLeave(false);
    setLeaveProgress(0);
  }, []);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) {
        clearInterval(leaveTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      <GameCanvas 
        playerName={playerName}
        isStakeMode={isStakeMode}
        walletAddress={walletAddress}
        onGameOver={handleGameOver}
        onUpdateStats={setStats}
        onEngineInit={setEngine}
      />
      
      <div className="absolute bottom-4 right-4 text-white/30 text-[10px] font-mono pointer-events-none select-none">
        FPS: {stats.fps} | Players: {stats.population}
      </div>

      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        {isStakeMode && (
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-accent/30 flex items-center gap-2" data-testid="balance-display">
            <Coins className="w-4 h-4 text-accent" />
            <span className="text-accent font-mono font-bold">{stats.balance?.toFixed(2) || '0.00'} USDC</span>
          </div>
        )}
        
        <div className="relative overflow-hidden rounded-md">
          <Button
            variant="outline"
            size="sm"
            className={`gap-2 border-destructive/50 text-destructive hover:bg-destructive/20 transition-all relative z-10`}
            onMouseDown={handleLeaveStart}
            onMouseUp={handleLeaveEnd}
            onMouseLeave={handleLeaveEnd}
            onTouchStart={handleLeaveStart}
            onTouchEnd={handleLeaveEnd}
            data-testid="button-leave"
          >
            <LogOut className="w-4 h-4" />
            {isHoldingLeave ? 'Leaving...' : 'Hold to Leave'}
          </Button>
          <div 
            className="absolute inset-0 bg-destructive/40 transition-all duration-75 ease-linear" 
            style={{ 
              width: `${leaveProgress * 100}%`,
              opacity: isHoldingLeave ? 1 : 0
            }} 
          />
        </div>
        
        {leaveError && (
          <div className="flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
            <AlertCircle className="w-3 h-3" />
            {leaveError}
          </div>
        )}
        
        {isStakeMode && (
          <div className="text-[10px] text-gray-500">
            {EXIT_FEE_PERCENT}% exit fee applies
          </div>
        )}
      </div>

      <Leaderboard players={leaderboard} />
      <Joystick engine={engine} />

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
          
          <div className="py-6 text-center space-y-4">
            <div>
              <div className="text-sm uppercase tracking-widest text-gray-500">Final Score</div>
              <div className="text-5xl font-mono font-bold text-primary">{Math.floor(gameOverStats?.score || 0)}</div>
            </div>
            {isStakeMode && gameOverStats?.balance !== undefined && (
              <div>
                <div className="text-sm uppercase tracking-widest text-gray-500">Remaining Balance</div>
                <div className="text-2xl font-mono font-bold text-accent">{gameOverStats.balance.toFixed(2)} USDC</div>
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-center gap-2">
            <Button variant="outline" onClick={handleExit} className="gap-2" data-testid="button-exit-game">
              <Home className="w-4 h-4" /> Exit
            </Button>
            <Button onClick={handleRestart} className="gap-2 bg-primary hover:bg-primary/90 text-white" data-testid="button-play-again">
              <RotateCcw className="w-4 h-4" /> Play Again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
