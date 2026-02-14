import React, { useEffect, useRef } from 'react';
import { GameEngine } from '@/game/GameEngine';

interface GameCanvasProps {
  playerName: string;
  isStakeMode: boolean;
  walletAddress?: string;
  playerColor?: string;
  characterShape?: 'circle' | 'triangle' | 'square';
  onGameOver: (stats: any) => void;
  onUpdateStats: (stats: any) => void;
  onEngineInit: (engine: GameEngine) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ 
  playerName, 
  isStakeMode, 
  walletAddress,
  playerColor,
  characterShape,
  onGameOver, 
  onUpdateStats,
  onEngineInit
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new GameEngine(
      canvasRef.current, 
      onGameOver,
      onUpdateStats
    );
    
    engineRef.current = engine;
    onEngineInit(engine);
    
    engine.start(playerName, isStakeMode, walletAddress, playerColor, characterShape);

    return () => {
      engine.stop();
    };
  }, []); // Run once on mount

  useEffect(() => {
    const keys = new Set<string>();

    const updateMovement = () => {
      if (!engineRef.current) return;
      let x = 0, y = 0;
      if (keys.has('w') || keys.has('arrowup')) y -= 1;
      if (keys.has('s') || keys.has('arrowdown')) y += 1;
      if (keys.has('a') || keys.has('arrowleft')) x -= 1;
      if (keys.has('d') || keys.has('arrowright')) x += 1;
      engineRef.current.handleInput({ x, y });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
        e.preventDefault();
        if (!keys.has(key)) {
          keys.add(key);
          updateMovement();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (keys.has(key)) {
        keys.delete(key);
        updateMovement();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="block w-full h-full touch-none"
    />
  );
};
