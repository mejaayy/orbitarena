import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { GameCanvas } from '@/components/game/GameCanvas';
import { Joystick } from '@/components/game/Joystick';
import { Leaderboard } from '@/components/game/Leaderboard';
import { GameEngine, RoundStatus, RoundEndData } from '@/game/GameEngine';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Home, RotateCcw, LogOut, Coins, AlertCircle, Users, Timer, Award } from 'lucide-react';
import { EXIT_FEE_PERCENT } from '@/lib/phantom';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

export default function Game() {
  const [location, setLocation] = useLocation();
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [stats, setStats] = useState({ fps: 60, population: 0, balance: 1 });
  const [gameOverStats, setGameOverStats] = useState<{ score: number, killer?: string, balance?: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isHoldingLeave, setIsHoldingLeave] = useState(false);
  const [leaveProgress, setLeaveProgress] = useState(0);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [roundStatus, setRoundStatus] = useState<RoundStatus | null>(null);
  const [roundEndData, setRoundEndData] = useState<RoundEndData | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const leaveStartRef = useRef<number>(0);
  const isHoldingQRef = useRef<boolean>(false);
  const isMobile = useIsMobile();

  const initialParams = useRef(() => {
    const raw = sessionStorage.getItem('orbit-arena-session');
    if (raw) {
      try {
        const data = JSON.parse(raw);
        return {
          playerName: data.name || 'Unknown',
          isStakeMode: !!data.stake,
          walletAddress: data.wallet || undefined,
          playerColor: data.color || undefined,
          characterShape: (data.shape as 'circle' | 'triangle' | 'square') || 'circle',
        };
      } catch {}
    }
    return {
      playerName: 'Unknown',
      isStakeMode: false,
      walletAddress: undefined,
      playerColor: undefined,
      characterShape: 'circle' as const,
    };
  }).current();
  const { playerName, isStakeMode, walletAddress, playerColor, characterShape } = initialParams;

  useEffect(() => {
    if (engine) {
      engine.onRoundStatusChange = setRoundStatus;
      engine.onRoundEnd = (data) => {
        setRoundEndData(data);
      };
      engine.onConnectionChange = (connected) => {
        if (isStakeMode) setIsReconnecting(!connected);
      };
    }
  }, [engine, isStakeMode]);

  useEffect(() => {
    if (!isStakeMode) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isStakeMode]);

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

  useEffect(() => {
    const preventSpaceButtons = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target instanceof HTMLButtonElement) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', preventSpaceButtons);
    return () => window.removeEventListener('keydown', preventSpaceButtons);
  }, []);

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
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20 p-4">
          <div className="bg-card/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-8 max-w-md w-full text-center">
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
              <div className="text-3xl font-mono font-bold text-accent">${(roundStatus.prizes.first + roundStatus.prizes.second + roundStatus.prizes.third).toFixed(2)}</div>
              <div className="text-xs text-gray-500 mt-2">
                1st: ${roundStatus.prizes.first} | 2nd: ${roundStatus.prizes.second} | 3rd: ${roundStatus.prizes.third}
              </div>
            </div>
            
            <Button
              variant="outline"
              onClick={() => setShowLeaveConfirm(true)}
              className="gap-2 border-[#D40046]/50 text-[#D40046] hover:bg-[#D40046]/20"
              data-testid="button-leave-lobby"
            >
              <LogOut className="w-4 h-4" /> Leave Lobby
            </Button>
          </div>
        </div>
      )}
      
      {isReconnecting && isStakeMode && (
        <div className="absolute inset-0 bg-black/85 flex items-center justify-center z-50">
          <div className="bg-card/95 backdrop-blur-xl border border-yellow-500/30 rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-yellow-400 animate-pulse" />
            </div>
            <h3 className="text-xl font-bold mb-2">Connection Lost</h3>
            <p className="text-gray-300 text-sm mb-1">Reconnecting to game server...</p>
            <p className="text-gray-500 text-xs">Your funds and position are safe. You have 15 seconds to reconnect before being marked as spectator.</p>
          </div>
        </div>
      )}

      {isSpectating && !roundEndData && (
        <div className="absolute top-14 md:top-20 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-sm px-4 md:px-6 py-2 md:py-3 rounded-lg border border-white/20 z-20">
          <div className="text-center">
            <div className="text-destructive font-bold text-sm md:text-lg">ELIMINATED</div>
            <div className="text-gray-300 text-xs md:text-sm">Spectating until round ends</div>
            {roundStatus?.timeRemaining && (
              <div className="text-white font-mono text-lg mt-1">
                {formatTime(roundStatus.timeRemaining)}
              </div>
            )}
          </div>
        </div>
      )}

      {isSpectating && isStakeMode && !roundEndData && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur-sm px-5 py-2 rounded-full border border-accent/40 z-20 whitespace-nowrap">
          <span className="text-accent text-xs md:text-sm font-medium">
            🏆 If you placed top 3, your USDC prize will be credited to your balance when the round ends
          </span>
        </div>
      )}
      
      <div className="absolute bottom-1 md:bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-4 md:translate-x-0 text-white/30 text-[10px] font-mono pointer-events-none select-none">
        FPS: {stats.fps} | Players: {stats.population}
      </div>

      {!gameOverStats && !isInLobby && !isSpectating && !isMobile && (
        <div className="absolute bottom-4 left-4 bg-black/70 backdrop-blur-sm rounded-lg border border-white/10 p-3 pointer-events-none select-none" data-testid="ability-hud">
          <div className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Abilities</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-4 mb-1">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-[#00CC7A]" />
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Health</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-[#D40046]" />
                <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Energy</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white">RIGHT CLICK</kbd>
              <span className="text-sm text-white">
                {characterShape === 'circle' ? 'Pull' : characterShape === 'triangle' ? 'Dash' : 'Push'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white">LEFT CLICK</kbd>
              <span className="text-sm text-white">
                {characterShape === 'circle' ? 'Slam' : characterShape === 'triangle' ? 'Shoot' : 'Stun Wave'}
              </span>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-2">20 energy each</div>
        </div>
      )}

      {!gameOverStats && !isInLobby && !isSpectating && isMobile && (
        <div className="absolute bottom-6 right-6 flex flex-col gap-4 z-30" data-testid="mobile-ability-buttons">
          <button
            className="w-20 h-20 rounded-full bg-white/15 backdrop-blur-sm border-2 border-white/30 active:bg-white/30 active:scale-95 transition-all flex flex-col items-center justify-center select-none touch-none"
            data-testid="mobile-ability1"
            onTouchStart={(e) => {
              e.preventDefault();
              engine?.startHoldAbility1();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              engine?.stopHoldAbility1();
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="text-white font-bold text-sm leading-none">
              {characterShape === 'circle' ? 'Pull' : characterShape === 'triangle' ? 'Dash' : 'Push'}
            </span>
          </button>
          <button
            className="w-20 h-20 rounded-full bg-[#D40046]/30 backdrop-blur-sm border-2 border-[#D40046]/50 active:bg-[#D40046]/50 active:scale-95 transition-all flex flex-col items-center justify-center select-none touch-none"
            data-testid="mobile-ability2"
            onTouchStart={(e) => {
              e.preventDefault();
              engine?.triggerAbility('ABILITY_2');
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="text-white font-bold text-sm leading-none">
              {characterShape === 'circle' ? 'Slam' : characterShape === 'triangle' ? 'Shoot' : 'Stun'}
            </span>
          </button>
        </div>
      )}

      <div className="absolute top-2 md:top-4 right-2 md:right-4 flex flex-col items-end gap-1.5 md:gap-2 z-20">
        {isStakeMode && isInRound && roundStatus?.timeRemaining && (
          <div className="bg-black/60 backdrop-blur-sm px-2 md:px-4 py-1 md:py-2 rounded-lg border border-white/20 flex items-center gap-1.5" data-testid="round-timer">
            <Timer className="w-3 h-3 md:w-4 md:h-4 text-white" />
            <span className="text-white font-mono font-bold text-sm md:text-lg">{formatTime(roundStatus.timeRemaining)}</span>
          </div>
        )}
        
        {isStakeMode && isInRound && (
          <div className="bg-black/60 backdrop-blur-sm px-2 md:px-4 py-1 md:py-2 rounded-lg border border-accent/30 flex items-center gap-1.5" data-testid="prize-pool-display">
            <Award className="w-3 h-3 md:w-4 md:h-4 text-accent" />
            <span className="text-accent font-mono font-bold text-xs md:text-base">Pool: ${(roundStatus?.prizes ? roundStatus.prizes.first + roundStatus.prizes.second + roundStatus.prizes.third : 9).toFixed(2)}</span>
          </div>
        )}
        
        {!isStakeMode && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-[#D40046]/50 text-[#D40046] hover:bg-[#D40046]/20 text-xs md:text-sm px-2 md:px-3"
            onClick={() => {
              engine?.sendLeave();
              setLocation('/');
            }}
            data-testid="button-leave"
          >
            <LogOut className="w-3 h-3 md:w-4 md:h-4" />
            {isMobile ? 'Leave' : 'Leave (Q)'}
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
              You were eliminated by <span className="font-bold text-white">{gameOverStats?.killer || 'Unknown'}</span>
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

      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent className="bg-card/90 backdrop-blur-xl border-white/10 sm:max-w-sm">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-[#D40046]/20 rounded-full flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 text-[#D40046]" />
            </div>
            <DialogTitle className="text-xl font-bold">Leave Lobby?</DialogTitle>
            <DialogDescription className="text-gray-300 text-sm leading-relaxed">
              Your $1.00 entry fee is <span className="text-white font-semibold">non-refundable</span>. Leaving now means you forfeit your entry fee and cannot rejoin this round.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 my-2 text-center">
            <div className="text-xs text-destructive font-semibold mb-0.5">No Refunds</div>
            <div className="text-xs text-gray-500">Your USDC balance is safe — only the $1.00 entry fee is forfeited.</div>
          </div>
          <DialogFooter className="sm:justify-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowLeaveConfirm(false)}
              data-testid="button-leave-cancel"
            >
              Stay in Lobby
            </Button>
            <Button
              variant="outline"
              className="gap-2 border-[#D40046]/50 text-[#D40046] hover:bg-[#D40046]/20"
              onClick={() => {
                setShowLeaveConfirm(false);
                engine?.sendLeave();
                setLocation('/');
              }}
              data-testid="button-leave-confirm"
            >
              <LogOut className="w-4 h-4" /> Leave & Forfeit
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
              Prize Pool: ${roundEndData?.prizePool?.toFixed(2) ?? '9.00'}
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const myResult = roundEndData?.standings.find(s => s.playerId === engine?.localPlayerId);
            if (!myResult) return null;
            if (myResult.prize > 0) {
              return (
                <div className="bg-accent/15 border border-accent/40 rounded-xl p-4 text-center">
                  <div className="text-xs uppercase tracking-widest text-gray-400 mb-1">Your Prize</div>
                  <div className="text-3xl font-mono font-bold text-accent">${myResult.prize.toFixed(2)} USDC</div>
                  <div className="text-xs text-gray-400 mt-2">✓ Credited to your in-game balance</div>
                </div>
              );
            }
            return (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                <div className="text-sm text-gray-400">You finished <span className="font-bold text-white">#{myResult.rank}</span> with {myResult.score} pts — no prize this round</div>
              </div>
            );
          })()}
          
          <div className="py-2 space-y-2">
            {roundEndData?.standings.slice(0, 5).map((player, index) => {
              const isLocal = player.playerId === engine?.localPlayerId;
              const isWinner = index < 3;
              const colors = ['text-yellow-400', 'text-gray-300', 'text-amber-600'];
              return (
                <div 
                  key={player.playerId}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isLocal ? 'bg-primary/20 border border-primary/40' : isWinner ? 'bg-accent/10 border border-accent/30' : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${colors[index] || 'text-gray-500'}`}>
                      #{player.rank}
                    </span>
                    <span className="font-semibold">{player.name}{isLocal && <span className="text-xs text-primary ml-1">(you)</span>}</span>
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
