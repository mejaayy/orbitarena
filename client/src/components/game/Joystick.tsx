import React from 'react';
import { Joystick as ReactJoystick } from 'react-joystick-component';
import { GameEngine } from '@/game/GameEngine';

interface JoystickProps {
  engine: GameEngine | null;
}

export const Joystick: React.FC<JoystickProps> = ({ engine }) => {
  const handleMove = (event: any) => {
    if (!engine) return;
    // event.x and event.y are normalized -1 to 1? Check docs or assume.
    // react-joystick-component gives x/y relative to center usually.
    if (event.x !== undefined && event.y !== undefined) {
      // Invert Y because Joystick is Cartesian (Up=Positive) but Canvas is Screen (Down=Positive)
      engine.handleInput({ x: event.x, y: -event.y });
    }
  };

  const handleStop = () => {
    if (!engine) return;
    engine.handleInput({ x: 0, y: 0 });
  };

  return (
    <div className="absolute bottom-12 left-12 z-50 md:hidden opacity-80">
      <ReactJoystick 
        size={100} 
        sticky={false} 
        baseColor="rgba(255, 255, 255, 0.1)" 
        stickColor="rgba(255, 255, 255, 0.5)" 
        move={handleMove} 
        stop={handleStop}
      />
    </div>
  );
};
