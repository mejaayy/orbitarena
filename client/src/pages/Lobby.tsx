import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Trophy, Coins, Gamepad2 } from 'lucide-react';
import solanaLogo from '@assets/generated_images/solana_crypto_coin_logo_icon.png';

export default function Lobby() {
  const [nickname, setNickname] = useState('');
  const [isStakeMode, setIsStakeMode] = useState(false);
  const [, setLocation] = useLocation();

  const handlePlay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    
    // Save to local storage for persistence (optional)
    localStorage.setItem('orbit-arena-nickname', nickname);
    
    // Navigate with query params
    setLocation(`/game?name=${encodeURIComponent(nickname)}&stake=${isStakeMode}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background decoration */}
      <div className="absolute inset-0 grid grid-cols-[repeat(20,1fr)] grid-rows-[repeat(20,1fr)] opacity-20 pointer-events-none">
        {Array.from({ length: 400 }).map((_, i) => (
          <div key={i} className="border-[0.5px] border-white/5" />
        ))}
      </div>
      
      {/* Animated Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 blur-[100px] rounded-full pointer-events-none animate-pulse" />

      <Card className="w-full max-w-md bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl relative z-10">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 border border-primary/50 shadow-[0_0_15px_rgba(124,58,237,0.5)]">
            <Gamepad2 className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-4xl font-black tracking-tight bg-gradient-to-br from-white to-gray-500 bg-clip-text text-transparent font-mono uppercase">
            Orbit Arena
          </CardTitle>
          <CardDescription className="text-gray-400 font-medium">
            Dominate the grid. Eat or be eaten.
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handlePlay} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-xs uppercase tracking-widest text-gray-500">
                Operative Name
              </Label>
              <Input
                id="nickname"
                placeholder="Enter your handle..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="bg-black/20 border-white/10 h-12 text-lg font-medium focus-visible:ring-primary/50 transition-all hover:border-white/20"
                autoFocus
                autoComplete="off"
              />
            </div>

            <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${isStakeMode ? 'bg-accent/20 text-accent' : 'bg-gray-800 text-gray-400'}`}>
                    {isStakeMode ? <Coins className="w-5 h-5" /> : <Trophy className="w-5 h-5" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Stake Mode</span>
                    <span className="text-xs text-gray-400">
                      {isStakeMode ? "Entry fee: 0.1 SOL" : "Practice for free"}
                    </span>
                  </div>
                </div>
                <Switch 
                  checked={isStakeMode}
                  onCheckedChange={setIsStakeMode}
                  className="data-[state=checked]:bg-accent"
                />
              </div>
              
              {isStakeMode && (
                <div className="text-xs text-accent/80 bg-accent/10 p-2 rounded border border-accent/20 flex items-center gap-2">
                  <img src={solanaLogo} className="w-4 h-4" alt="SOL" />
                  <span>Mock Wallet Connected: 12.5 SOL</span>
                </div>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-14 text-lg font-bold uppercase tracking-wider shadow-lg hover:shadow-primary/25 transition-all"
              size="lg"
            >
              Enter Arena
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
