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

  // Handle Input
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!engineRef.current || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      
      engineRef.current.handleInput({ x: dx, y: dy });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="block w-full h-full touch-none"
    />
  );
};
