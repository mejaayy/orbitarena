import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { GameCanvas } from '@/components/game/GameCanvas';
import { Joystick } from '@/components/game/Joystick';
import { Leaderboard } from '@/components/game/Leaderboard';
import { GameEngine, RoundStatus, RoundEndData } from '@/game/GameEngine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Home, RotateCcw, LogOut, Coins, AlertCircle, Users, Timer, Award } from 'lucide-react';
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
  const [roundStatus, setRoundStatus] = useState<RoundStatus | null>(null);
  const [roundEndData, setRoundEndData] = useState<RoundEndData | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leaveStartRef = useRef<number>(0);
  const isHoldingQRef = useRef<boolean>(false);

  const searchParams = new URLSearchParams(window.location.search);
  const playerName = searchParams.get('name') || 'Unknown';
  const isStakeMode = searchParams.get('stake') === 'true';
  const walletAddress = searchParams.get('wallet') || undefined;
  const playerColor = searchParams.get('color') || undefined;
  const characterShape = (searchParams.get('shape') as 'circle' | 'triangle' | 'square') || 'circle';

  useEffect(() => {
    if (engine) {
      engine.onRoundStatusChange = setRoundStatus;
      engine.onRoundEnd = (data) => {
        setRoundEndData(data);
      };
    }
  }, [engine]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (engine) {
        const players = Array.from(engine.players.values())
          .sort((a, b) => b.score - a.score)
          .map(p => ({ id: p.id, name: p.name, score: p.score, balance: p.balance }));
        setLeaderboard(players);
        setIsSpectating(engine.isSpectating);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [engine]);

  const handleGameOver = (stats: { score: number, killer?: string, balance?: number }) => {
    setGameOverStats(stats);
  };

  const handleRestart = () => {
    setGameOverStats(null);
    setRoundEndData(null);
    setIsSpectating(false);
    engine?.start(playerName, isStakeMode, walletAddress, playerColor, characterShape);
  };

  const handleExit = () => {
    setLocation('/');
  };

  const handleLeaveStart = useCallback(() => {
    if (isStakeMode && roundStatus?.roundState === 'PLAYING') {
      setLeaveError('Cannot leave during an active round');
      return;
    }
    
    setIsHoldingLeave(true);
    setLeaveError(null);
    leaveStartRef.current = Date.now();
    
    leaveTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - leaveStartRef.current;
      const progress = Math.min(elapsed / 2000, 1);
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
          setLeaveError('Cannot leave right now');
          setLeaveProgress(0);
          setIsHoldingLeave(false);
        }
      }
    }, 50);
  }, [engine, setLocation, isStakeMode, roundStatus]);

  const handleLeaveEnd = useCallback(() => {
    if (leaveTimerRef.current) {
      clearInterval(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsHoldingLeave(false);
    setLeaveProgress(0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'q' || e.key === 'Q') && !isStakeMode && !gameOverStats && !roundEndData) {
        e.preventDefault();
        engine?.sendLeave();
        setLocation('/');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [engine, setLocation, isStakeMode, gameOverStats, roundEndData]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isInLobby = isStakeMode && roundStatus && (roundStatus.roundState === 'LOBBY' || roundStatus.roundState === 'COUNTDOWN');
  const isInRound = isStakeMode && roundStatus && roundStatus.roundState === 'PLAYING';

  return (
    <div className="w-full h-screen relative bg-black overflow-hidden">
      <GameCanvas 
        playerName={playerName}
        isStakeMode={isStakeMode}
        walletAddress={walletAddress}
        playerColor={playerColor}
        characterShape={characterShape}
        onGameOver={handleGameOver}
        onUpdateStats={setStats}
        onEngineInit={setEngine}
      />
      
      {isInLobby && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 text-center">
            <div className="mx-auto w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-accent" />
            </div>
            
            <h2 className="text-2xl font-bold mb-2">
              {roundStatus.roundState === 'COUNTDOWN' ? 'Round Starting!' : 'Waiting for Players'}
            </h2>
            
            <div className="text-6xl font-mono font-bold text-primary my-6">
              {roundStatus.roundState === 'COUNTDOWN' 
                ? Math.ceil(roundStatus.countdownRemaining / 1000)
                : `${roundStatus.playerCount}/${roundStatus.maxPlayers}`}
            </div>
            
            {roundStatus.roundState === 'LOBBY' && (
              <p className="text-gray-400 mb-4">
                Waiting for {roundStatus.maxPlayers - roundStatus.playerCount} more player{roundStatus.maxPlayers - roundStatus.playerCount !== 1 ? 's' : ''}
              </p>
            )}
            
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-4 mb-6">
              <div className="text-sm text-gray-400 mb-1">Prize Pool</div>
              <div className="text-3xl font-mono font-bold text-accent">${roundStatus.prizePool.toFixed(2)}</div>
              <div className="text-xs text-gray-500 mt-2">
                1st: ${roundStatus.prizes.first} | 2nd: ${roundStatus.prizes.second} | 3rd: ${roundStatus.prizes.third}
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={() => {
                engine?.sendLeave();
                setLocation('/');
              }}
              className="gap-2"
              data-testid="button-leave-lobby"
            >
              <LogOut className="w-4 h-4" /> Leave Lobby
            </Button>
          </div>
        </div>
      )}
      
      {isSpectating && !roundEndData && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/20 z-20">
          <div className="text-center">
            <div className="text-destructive font-bold text-lg">ELIMINATED</div>
            <div className="text-gray-300 text-sm">Spectating until round ends</div>
            {roundStatus?.timeRemaining && (
              <div className="text-white font-mono text-lg mt-1">
                {formatTime(roundStatus.timeRemaining)}
              </div>
            )}
          </div>
        </div>
      )}
      
      <div className="absolute bottom-4 right-4 text-white/30 text-[10px] font-mono pointer-events-none select-none">
        FPS: {stats.fps} | Players: {stats.population}
      </div>

      {!gameOverStats && !isInLobby && !isSpectating && (
        <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 p-3 pointer-events-none select-none" data-testid="ability-hud">
          <div className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Abilities</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white">SPACE</kbd>
              <span className="text-sm text-white">
                {characterShape === 'circle' ? 'Pull' : characterShape === 'triangle' ? 'Dash' : 'Push'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white">CLICK</kbd>
              <span className="text-sm text-white">
                {characterShape === 'circle' ? 'Slam' : characterShape === 'triangle' ? 'Pierce' : 'Stun Wave'}
              </span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2">40 charge each</div>
        </div>
      )}

      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        {isStakeMode && isInRound && roundStatus?.timeRemaining && (
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20 flex items-center gap-2" data-testid="round-timer">
            <Timer className="w-4 h-4 text-white" />
            <span className="text-white font-mono font-bold text-lg">{formatTime(roundStatus.timeRemaining)}</span>
          </div>
        )}
        
        {isStakeMode && isInRound && (
          <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg border border-accent/30 flex items-center gap-2" data-testid="prize-pool-display">
            <Award className="w-4 h-4 text-accent" />
            <span className="text-accent font-mono font-bold">Pool: ${roundStatus?.prizePool?.toFixed(2)}</span>
          </div>
        )}
        
        {!isStakeMode && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/20"
            onClick={() => {
              engine?.sendLeave();
              setLocation('/');
            }}
            data-testid="button-leave"
          >
            <LogOut className="w-4 h-4" />
            Leave (Q)
          </Button>
        )}
      </div>

      {!isInLobby && <Leaderboard players={leaderboard} localPlayerId={engine?.localPlayerId || null} timeRemaining={roundStatus?.timeRemaining} isStakeMode={isStakeMode} />}
      {!isSpectating && !isInLobby && <Joystick engine={engine} />}

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

      <Dialog open={!!roundEndData} onOpenChange={() => {}}>
        <DialogContent className="bg-card/90 backdrop-blur-xl border-white/10 sm:max-w-lg">
          <DialogHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mb-4">
              <Trophy className="w-8 h-8 text-accent" />
            </div>
            <DialogTitle className="text-3xl font-black uppercase">Round Complete!</DialogTitle>
            <DialogDescription className="text-lg text-gray-300">
              Prize Pool: ${roundEndData?.prizePool?.toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-3">
            {roundEndData?.standings.slice(0, 5).map((player, index) => {
              const isWinner = index < 3;
              const colors = ['text-yellow-400', 'text-gray-300', 'text-amber-600'];
              return (
                <div 
                  key={player.playerId}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isWinner ? 'bg-accent/10 border border-accent/30' : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${colors[index] || 'text-gray-500'}`}>
                      #{player.rank}
                    </span>
                    <span className="font-semibold">{player.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-400">{player.score} pts</div>
                    {player.prize > 0 && (
                      <div className="text-accent font-bold">${player.prize.toFixed(2)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="sm:justify-center gap-2">
            <Button variant="outline" onClick={handleExit} className="gap-2" data-testid="button-exit-round">
              <Home className="w-4 h-4" /> Exit
            </Button>
            <Button onClick={handleRestart} className="gap-2 bg-primary hover:bg-primary/90 text-white" data-testid="button-next-round">
              <RotateCcw className="w-4 h-4" /> Join Next Round
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
