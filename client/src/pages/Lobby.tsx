import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Coins, Gamepad2, Wallet, ExternalLink, Users, AlertTriangle } from 'lucide-react';
import solanaLogo from '@assets/generated_images/solana_crypto_coin_logo_icon.png';
import { connectPhantom, disconnectPhantom, isPhantomInstalled, getConnectedWallet, shortenAddress, ENTRY_FEE_USDC, getUSDCBalance } from '@/lib/phantom';

export default function Lobby() {
  const [nickname, setNickname] = useState('');
  const [isStakeMode, setIsStakeMode] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ playerCount: number; maxPlayers: number; roomCount: number } | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#D40046');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [, setLocation] = useLocation();

  const AVATAR_COLORS = [
    { name: 'Red', hex: '#D40046' },
    { name: 'Green', hex: '#00CC7A' },
    { name: 'Blue', hex: '#00A3CC' },
    { name: 'Orange', hex: '#CC7A00' },
    { name: 'Purple', hex: '#A300CC' },
    { name: 'Yellow', hex: '#CCCC00' },
    { name: 'Pink', hex: '#FF69B4' },
    { name: 'Cyan', hex: '#00FFFF' },
  ];

  useEffect(() => {
    const savedNickname = localStorage.getItem('orbit-arena-nickname');
    if (savedNickname) setNickname(savedNickname);
    
    const hasAcceptedTerms = localStorage.getItem('orbit-arena-terms-accepted');
    if (hasAcceptedTerms === 'true') {
      setTermsAccepted(true);
    } else {
      setShowTerms(true);
    }
    
    const connected = getConnectedWallet();
    if (connected) {
      setWalletAddress(connected);
      getUSDCBalance(connected).then(setWalletBalance);
    }
    
    const savedColor = localStorage.getItem('orbit-arena-color');
    if (savedColor) setSelectedColor(savedColor);

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/game/status');
        const data = await res.json();
        setServerStatus(data);
      } catch (e) {
        console.error('Failed to fetch server status');
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConnectWallet = async () => {
    setIsConnecting(true);
    try {
      const address = await connectPhantom();
      setWalletAddress(address);
      if (address) {
        const balance = await getUSDCBalance(address);
        setWalletBalance(balance);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectWallet = async () => {
    await disconnectPhantom();
    setWalletAddress(null);
    setWalletBalance(null);
    setIsStakeMode(false);
  };

  const handlePlay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    
    if (isStakeMode && !walletAddress) {
      return;
    }
    
    if (!termsAccepted) {
      setShowTerms(true);
      return;
    }
    
    localStorage.setItem('orbit-arena-nickname', nickname);
    localStorage.setItem('orbit-arena-color', selectedColor);
    
    const params = new URLSearchParams({
      name: nickname,
      stake: String(isStakeMode),
      color: selectedColor
    });
    if (walletAddress) {
      params.set('wallet', walletAddress);
    }
    
    setLocation(`/game?${params.toString()}`);
  };

  const handleAcceptTerms = () => {
    setTermsAccepted(true);
    localStorage.setItem('orbit-arena-terms-accepted', 'true');
    setShowTerms(false);
  };

  const canPlay = nickname.trim() && (!isStakeMode || walletAddress);

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      <div className="absolute inset-0 grid grid-cols-[repeat(20,1fr)] grid-rows-[repeat(20,1fr)] opacity-20 pointer-events-none">
        {Array.from({ length: 400 }).map((_, i) => (
          <div key={i} className="border-[0.5px] border-white/5" />
        ))}
      </div>
      
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
          {serverStatus && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mt-2" data-testid="server-status">
              <Users className="w-3 h-3" />
              <span>{serverStatus.playerCount} players online</span>
            </div>
          )}
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handlePlay} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-xs uppercase tracking-widest text-gray-500">
                Operative Name
              </Label>
              <Input
                id="nickname"
                data-testid="input-nickname"
                placeholder="Enter your handle..."
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="bg-black/20 border-white/10 h-12 text-lg font-medium focus-visible:ring-primary/50 transition-all hover:border-white/20"
                autoFocus
                autoComplete="off"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-widest text-gray-500">Color</Label>
              <div className="flex gap-1.5">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color.hex}
                    type="button"
                    onClick={() => setSelectedColor(color.hex)}
                    className={`w-5 h-5 rounded-full transition-all hover:scale-110 ${
                      selectedColor === color.hex ? 'ring-2 ring-white ring-offset-1 ring-offset-black' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                    data-testid={`color-${color.name.toLowerCase()}`}
                  />
                ))}
              </div>
            </div>

            <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${isStakeMode ? 'bg-accent/20 text-accent' : 'bg-gray-800 text-gray-400'}`}>
                    {isStakeMode ? <Coins className="w-5 h-5" /> : <Trophy className="w-5 h-5" />}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Solana Mode</span>
                    <span className="text-xs text-gray-400">
                      {isStakeMode ? `Entry: ${ENTRY_FEE_USDC} USDC` : "Play for USDC"}
                    </span>
                  </div>
                </div>
                <Switch 
                  checked={isStakeMode}
                  onCheckedChange={(checked) => {
                    if (checked && !walletAddress) {
                      handleConnectWallet();
                    }
                    setIsStakeMode(checked);
                  }}
                  className="data-[state=checked]:bg-accent"
                  data-testid="switch-solana-mode"
                />
              </div>
              
              {isStakeMode && (
                <div className="space-y-3">
                  {walletAddress ? (
                    <div className="flex flex-col gap-2 bg-accent/10 p-3 rounded-lg border border-accent/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <img src={solanaLogo} className="w-5 h-5" alt="SOL" />
                          <span className="text-sm font-mono text-accent">{shortenAddress(walletAddress)}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleDisconnectWallet}
                          className="text-xs text-gray-400 hover:text-white"
                          data-testid="button-disconnect-wallet"
                        >
                          Disconnect
                        </Button>
                      </div>
                      {walletBalance !== null && (
                        <div className="text-sm text-accent/80 font-mono" data-testid="wallet-balance">
                          Balance: {walletBalance.toFixed(2)} USDC
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={handleConnectWallet}
                      disabled={isConnecting}
                      data-testid="button-connect-wallet"
                    >
                      <Wallet className="w-4 h-4" />
                      {isConnecting ? 'Connecting...' : isPhantomInstalled() ? 'Connect Phantom Wallet' : 'Install Phantom'}
                      {!isPhantomInstalled() && <ExternalLink className="w-3 h-3" />}
                    </Button>
                  )}
                  
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>Devnet USDC required. Eliminate players to earn.</p>
                    <p>10% exit fee applies when leaving.</p>
                  </div>
                </div>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-14 text-lg font-bold uppercase tracking-wider shadow-lg hover:shadow-primary/25 transition-all"
              size="lg"
              disabled={!canPlay}
              data-testid="button-enter-arena"
            >
              Enter Arena
            </Button>
            
            <button
              type="button"
              onClick={() => setLocation('/terms')}
              className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
              data-testid="link-terms"
            >
              Terms & Conditions
            </button>
          </form>
        </CardContent>
      </Card>

      <Dialog open={showTerms} onOpenChange={setShowTerms}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-white/10 sm:max-w-md">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center mb-4 text-amber-500">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <DialogTitle className="text-2xl font-bold">Terms of Play</DialogTitle>
            <DialogDescription className="text-gray-400">
              Please read and accept before entering
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-black/30 p-4 rounded-lg border border-white/10 space-y-3 text-sm text-gray-300">
              <p>This is a skill-based game.</p>
              <p>All payments are non-refundable.</p>
              <p>Balances and earnings are not guaranteed.</p>
            </div>
            
            <p className="text-sm text-gray-400 text-center">
              By clicking "I Accept", you confirm you are 18+ and agree to these terms.
            </p>
          </div>

          <DialogFooter className="sm:justify-center">
            <Button 
              onClick={handleAcceptTerms}
              className="bg-primary hover:bg-primary/90 text-white w-full"
              data-testid="button-accept-terms"
            >
              I Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
