import React, { useEffect, useRef } from 'react';
import { GameEngine } from '@/game/GameEngine';

interface GameCanvasProps {
  playerName: string;
  isStakeMode: boolean;
  walletAddress?: string;
  playerColor?: string;
  onGameOver: (stats: any) => void;
  onUpdateStats: (stats: any) => void;
  onEngineInit: (engine: GameEngine) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ 
  playerName, 
  isStakeMode, 
  walletAddress,
  playerColor,
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
    
    engine.start(playerName, isStakeMode, walletAddress, playerColor);

    return () => {
      engine.stop();
    };
  }, []); // Run once on mount

  // Handle Input
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!engineRef.current) return;
      const { width, height } = canvasRef.current!;
      const cx = width / 2;
      const cy = height / 2;
      
      // Calculate vector from center to mouse
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
