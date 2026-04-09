import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trophy, Coins, Gamepad2, Wallet, ExternalLink, Users, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, History, Crown, ChevronRight, Zap, Target, Shield } from 'lucide-react';
import solanaLogo from '@assets/generated_images/solana_crypto_coin_logo_icon.png';
import { connectPhantom, disconnectPhantom, isPhantomInstalled, getConnectedWallet, shortenAddress, ENTRY_FEE_USDC, getUSDCBalance, fetchSolanaConfig, sendUSDCDeposit } from '@/lib/phantom';
import { AdminPanel } from '@/components/AdminPanel';
import { containsProfanity } from '@/lib/profanityFilter';

const MOCK_LEADERBOARD: WeeklyPlayer[] = [
  { wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', earnedUsd: '42.50' },
  { wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', earnedUsd: '36.00' },
  { wallet: '3yFwqXBfZY4jBVUafQ1YEXw189y3STbUdGxkd4Db9WVQ', earnedUsd: '28.50' },
  { wallet: '5mLjVxG8r3xYkzCMc9VPc6AhYTL9sFQzKqKvCrLwpj1D', earnedUsd: '24.00' },
  { wallet: 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy', earnedUsd: '19.50' },
  { wallet: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D33p7g6vH7cM', earnedUsd: '15.00' },
  { wallet: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', earnedUsd: '12.00' },
  { wallet: '2fmz5FvJynQLLmJhddPLrtdmMuVqhC7gLj9YzRt3UWCv', earnedUsd: '9.00' },
  { wallet: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS', earnedUsd: '6.00' },
  { wallet: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', earnedUsd: '4.50' },
];

interface WeeklyPlayer {
  wallet: string;
  earnedUsd: string;
}

interface InternalBalance {
  availableCents: number;
  lockedCents: number;
  availableUsd: string;
  lockedUsd: string;
  lifetime: {
    deposited: string;
    withdrawn: string;
    prizes: string;
  };
}

interface Transaction {
  id: string;
  type: string;
  deltaAvailable: number;
  deltaLocked: number;
  createdAt: string;
  metadata: any;
}

export default function Lobby() {
  const [nickname, setNickname] = useState('');
  const [isStakeMode, setIsStakeMode] = useState(false);
  const mountTimeRef = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serverStatus, setServerStatus] = useState<{ playerCount: number; maxPlayers: number; roomCount: number } | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#D40046');
  const [selectedShape, setSelectedShape] = useState<'circle' | 'triangle' | 'square'>('circle');
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [internalBalance, setInternalBalance] = useState<InternalBalance | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [depositAmount, setDepositAmount] = useState('5');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<WeeklyPlayer[]>([]);
  const [mockLeaderboardEnabled, setMockLeaderboardEnabled] = useState(false);
  const [showMobileLeaderboard, setShowMobileLeaderboard] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [, setLocation] = useLocation();

  const AVATAR_COLORS = [
    { name: 'Red', hex: '#D40046' },
    { name: 'Green', hex: '#00CC7A' },
    { name: 'Blue', hex: '#00A3CC' },
    { name: 'Purple', hex: '#A300CC' },
    { name: 'Yellow', hex: '#CCCC00' },
    { name: 'Pink', hex: '#FF69B4' },
  ];

  const fetchInternalBalance = async (address: string) => {
    try {
      const res = await fetch(`/api/balance/${address}`);
      if (res.ok) {
        const data = await res.json();
        setInternalBalance(data);
      }
    } catch (e) {
      console.error('Failed to fetch internal balance');
    }
  };

  const fetchTransactions = async (address: string) => {
    try {
      const res = await fetch(`/api/balance/${address}/transactions?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (e) {
      console.error('Failed to fetch transactions');
    }
  };

  useEffect(() => {
    // Load Solana network config from server (sets platform wallet, USDC mint, network)
    fetchSolanaConfig().catch(err => console.error('Failed to load Solana config:', err));

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
      fetchInternalBalance(connected);
    }
    
    const savedColor = localStorage.getItem('orbit-arena-color');
    const validColors = ['#D40046', '#00CC7A', '#00A3CC', '#A300CC', '#CCCC00', '#FF69B4'];
    if (savedColor && validColors.includes(savedColor)) setSelectedColor(savedColor);
    
    const savedShape = localStorage.getItem('orbit-arena-shape') as 'circle' | 'triangle' | 'square' | null;
    if (savedShape) setSelectedShape(savedShape);

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
    
    // Fetch weekly leaderboard
    const fetchWeeklyLeaderboard = async () => {
      try {
        const res = await fetch('/api/leaderboard/weekly');
        if (res.ok) {
          const data = await res.json();
          setWeeklyLeaderboard(data.players || []);
        }
      } catch (e) {
        console.error('Failed to fetch weekly leaderboard');
      }
    };
    fetchWeeklyLeaderboard();
    
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
        await fetchInternalBalance(address);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectWallet = async () => {
    await disconnectPhantom();
    setWalletAddress(null);
    setWalletBalance(null);
    setInternalBalance(null);
    setIsStakeMode(false);
  };

  const handleDeposit = async () => {
    if (!walletAddress || !depositAmount) return;
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    setIsProcessing(true);
    try {
      const amountCents = Math.round(amount * 100);

      // Step 1: Create a deposit request on the server (returns a token)
      const reqRes = await fetch('/api/balance/deposit/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, amountCents }),
      });
      const reqData = await reqRes.json();
      if (!reqRes.ok) {
        alert(reqData.error || 'Failed to initiate deposit');
        return;
      }
      const { depositToken } = reqData;

      // Step 2: Send actual USDC on-chain via Phantom
      const depositResult = await sendUSDCDeposit(walletAddress, amountCents);
      if (!depositResult.success) {
        alert(depositResult.error || 'Wallet transaction failed — no USDC was transferred');
        return;
      }

      // Step 3: Confirm with the server (server verifies the on-chain tx)
      const confirmRes = await fetch('/api/balance/deposit/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositToken, onChainTxSignature: depositResult.txSignature }),
      });
      const confirmData = await confirmRes.json();
      if (confirmRes.ok) {
        await fetchInternalBalance(walletAddress);
        await getUSDCBalance(walletAddress).then(setWalletBalance);
        setShowDeposit(false);
        setDepositAmount('5');
      } else {
        alert(confirmData.error || 'Deposit verification failed. Contact support with your transaction signature: ' + depositResult.txSignature);
      }
    } catch (e: any) {
      alert(e?.message || 'Network error, please try again');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!walletAddress || !withdrawAmount) return;
    const amount = parseFloat(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    if (internalBalance && amount * 100 > internalBalance.availableCents) {
      alert('Insufficient balance');
      return;
    }
    setIsProcessing(true);
    try {
      const amountCents = Math.round(amount * 100);
      const res = await fetch('/api/balance/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, amountCents }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchInternalBalance(walletAddress);
        setShowWithdraw(false);
        setWithdrawAmount('');
      } else {
        alert(data.error || 'Withdrawal failed');
      }
    } catch (e) {
      alert('Network error, please try again');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShowHistory = async () => {
    if (walletAddress) {
      await fetchTransactions(walletAddress);
      setShowHistory(true);
    }
  };

  const [nameError, setNameError] = useState('');

  const handlePlay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;

    if (containsProfanity(nickname)) {
      setNameError('That name contains inappropriate language. Please choose another.');
      return;
    }
    setNameError('');
    
    if (isStakeMode && !walletAddress) {
      return;
    }
    
    if (!termsAccepted) {
      setShowTerms(true);
      return;
    }
    
    localStorage.setItem('orbit-arena-nickname', nickname);
    localStorage.setItem('orbit-arena-color', selectedColor);
    localStorage.setItem('orbit-arena-shape', selectedShape);
    
    sessionStorage.setItem('orbit-arena-session', JSON.stringify({
      name: nickname,
      stake: isStakeMode,
      color: selectedColor,
      shape: selectedShape,
      wallet: walletAddress || '',
    }));
    
    setLocation('/game');
  };

  const handleAcceptTerms = () => {
    setTermsAccepted(true);
    localStorage.setItem('orbit-arena-terms-accepted', 'true');
    setShowTerms(false);
    // Show tutorial only on first ever visit
    if (!localStorage.getItem('orbit-arena-tutorial-seen')) {
      setTutorialStep(0);
      setShowTutorial(true);
    }
  };

  const handleTutorialNext = () => {
    if (tutorialStep < 4) {
      setTutorialStep(s => s + 1);
    } else {
      setShowTutorial(false);
      localStorage.setItem('orbit-arena-tutorial-seen', 'true');
    }
  };

  const handleTutorialSkip = () => {
    setShowTutorial(false);
    localStorage.setItem('orbit-arena-tutorial-seen', 'true');
  };

  const canPlay = nickname.trim() && (!isStakeMode || walletAddress);

  return (
    <div className="min-h-screen flex items-start md:items-center justify-center relative overflow-y-auto bg-background py-4 md:py-0">
      <canvas
        ref={(canvas) => {
          if (!canvas || canvas.dataset.drawn) return;
          canvas.dataset.drawn = 'true';
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
          const hexSize = 100;
          const hexWidth = Math.sqrt(3) * hexSize;
          const vertSpacing = hexSize * 1.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const rows = Math.ceil(canvas.height / vertSpacing) + 2;
          const cols = Math.ceil(canvas.width / hexWidth) + 2;
          for (let row = -1; row <= rows; row++) {
            for (let col = -1; col <= cols; col++) {
              const offsetX = (row % 2 === 0) ? 0 : hexWidth / 2;
              const cx = col * hexWidth + offsetX;
              const cy = row * vertSpacing;
              for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                const x = cx + hexSize * Math.cos(angle);
                const y = cy + hexSize * Math.sin(angle);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
            }
          }
          ctx.stroke();
        }}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {(mockLeaderboardEnabled ? MOCK_LEADERBOARD : weeklyLeaderboard).length > 0 && (
        <div className="hidden md:block fixed top-4 left-4 z-20" data-testid="weekly-leaderboard">
          <div className="bg-card/90 backdrop-blur-xl border border-white/10 rounded-lg p-4 w-64 shadow-xl">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-bold text-white uppercase tracking-wide">Top Weekly Players</span>
              {mockLeaderboardEnabled && (
                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">PREVIEW</span>
              )}
            </div>
            <div className="space-y-2">
              {(mockLeaderboardEnabled ? MOCK_LEADERBOARD : weeklyLeaderboard).slice(0, 10).map((player, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between text-sm"
                  data-testid={`weekly-player-${index}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-5 text-center font-bold ${
                      index === 0 ? 'text-yellow-400' : 
                      index === 1 ? 'text-gray-300' : 
                      index === 2 ? 'text-amber-600' : 'text-gray-500'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="text-white font-mono text-xs">{player.wallet.slice(0, 4)}...{player.wallet.slice(-4)}</span>
                  </div>
                  <span className="text-green-400 font-mono font-bold">{player.earnedUsd} USDC</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-3 text-center italic">
              Based on in-game performance. Displayed amounts are not guaranteed. No refunds.
            </p>
          </div>
        </div>
      )}

      <Card className="w-full max-w-md mx-4 md:mx-0 bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl relative z-10">
        {/* Help / tutorial button */}
        <button
          type="button"
          onClick={() => { setTutorialStep(0); setShowTutorial(true); }}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-gray-400 hover:text-white text-xs font-bold transition-all z-20"
          data-testid="button-open-tutorial"
          title="How to play"
        >
          ?
        </button>
        <CardHeader className="text-center pb-2 px-4 md:px-6">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight font-mono uppercase" style={{ color: '#D40046' }}>
            Orbit Arena
          </h1>
          <CardDescription className="text-gray-400 font-medium">
            Dominate the grid. Fight or fall.
          </CardDescription>
          {serverStatus && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mt-2" data-testid="server-status">
              <Users className="w-3 h-3" />
              <span>{serverStatus.playerCount} players online</span>
            </div>
          )}
          {(mockLeaderboardEnabled ? MOCK_LEADERBOARD : weeklyLeaderboard).length > 0 && (
            <button
              type="button"
              onClick={() => setShowMobileLeaderboard(true)}
              className="md:hidden flex items-center justify-center gap-1.5 text-xs text-yellow-400 mt-2 hover:text-yellow-300 transition-colors"
              data-testid="button-mobile-leaderboard"
            >
              <Crown className="w-3 h-3" />
              <span>View Leaderboard</span>
            </button>
          )}
        </CardHeader>
        
        <CardContent className="px-4 md:px-6">
          <form onSubmit={handlePlay} className="space-y-4 md:space-y-6">
            <div className="space-y-2">
              <Label htmlFor="nickname" className="text-xs uppercase tracking-widest text-gray-500">
                Operative Name
              </Label>
              <Input
                id="nickname"
                data-testid="input-nickname"
                placeholder="Enter your handle..."
                value={nickname}
                onChange={(e) => {
                  const value = e.target.value;
                  // Block 'q' characters for 500ms after mount (from holding Q to leave game)
                  const cleaned = Date.now() - mountTimeRef.current < 500
                    ? value.replace(/[qQ]/g, '')
                    : value;
                  setNickname(cleaned.slice(0, 10));
                }}
                className="bg-black/20 border-white/10 h-12 text-lg font-medium focus-visible:ring-[#D40046]/50 transition-all hover:border-white/20"
                autoFocus
                autoComplete="off"
              />
              {nameError && (
                <p className="text-red-400 text-xs mt-1" data-testid="text-name-error">{nameError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-widest text-gray-500">Character</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedShape('circle')}
                  className={`p-3 rounded-xl transition-all border ${
                    selectedShape === 'circle' 
                      ? 'bg-white/15 border-white/40 ring-2 ring-white/50' 
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                  data-testid="shape-circle"
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-8 h-8">
                      <circle cx="12" cy="12" r="10" fill={selectedColor} />
                    </svg>
                    <span className="text-xs font-medium text-white">Circle</span>
                    <div className="text-[10px] text-gray-400 leading-tight text-center">
                      Pull • Slam
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedShape('triangle')}
                  className={`p-3 rounded-xl transition-all border ${
                    selectedShape === 'triangle' 
                      ? 'bg-white/15 border-white/40 ring-2 ring-white/50' 
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                  data-testid="shape-triangle"
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-8 h-8">
                      <polygon points="12,2 22,20 2,20" fill={selectedColor} />
                    </svg>
                    <span className="text-xs font-medium text-white">Triangle</span>
                    <div className="text-[10px] text-gray-400 leading-tight text-center">
                      Dash • Shoot
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedShape('square')}
                  className={`p-3 rounded-xl transition-all border ${
                    selectedShape === 'square' 
                      ? 'bg-white/15 border-white/40 ring-2 ring-white/50' 
                      : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                  }`}
                  data-testid="shape-square"
                >
                  <div className="flex flex-col items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-8 h-8">
                      <rect x="2" y="2" width="20" height="20" fill={selectedColor} />
                    </svg>
                    <span className="text-xs font-medium text-white">Square</span>
                    <div className="text-[10px] text-gray-400 leading-tight text-center">
                      Push • Stun Wave
                    </div>
                  </div>
                </button>
              </div>
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
                    <div className="flex flex-col gap-3 bg-accent/10 p-3 rounded-lg border border-accent/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <img src={solanaLogo} className="w-5 h-5" alt="SOL" />
                          <span className="text-sm font-mono text-accent">{shortenAddress(walletAddress)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setLocation(`/profile?wallet=${walletAddress}`)}
                            className="text-xs text-accent/70 hover:text-accent"
                            data-testid="button-view-profile"
                          >
                            Profile
                          </Button>
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
                      </div>
                      
                      <div className="bg-black/30 p-2 rounded-lg space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">Game Balance</span>
                          <span className="text-lg font-bold text-accent" data-testid="game-balance">
                            ${internalBalance?.availableUsd || '0.00'}
                          </span>
                        </div>
                        {internalBalance && internalBalance.lockedCents > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Locked in match</span>
                            <span className="text-yellow-500">${internalBalance.lockedUsd}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDeposit(true)}
                          className="flex-1 gap-1 text-xs"
                          data-testid="button-deposit"
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                          Deposit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowWithdraw(true)}
                          className="flex-1 gap-1 text-xs"
                          disabled={!internalBalance || internalBalance.availableCents === 0}
                          data-testid="button-withdraw"
                        >
                          <ArrowUpFromLine className="w-3 h-3" />
                          Withdraw
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleShowHistory}
                          className="gap-1 text-xs"
                          data-testid="button-history"
                        >
                          <History className="w-3 h-3" />
                        </Button>
                      </div>
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
                    <p>Pay entry fee to compete for prizes!</p>
                    <p>Prizes grow with each player · up to 1st: $6 | 2nd: $4.50 | 3rd: $3</p>
                  </div>
                </div>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full h-14 text-lg font-bold uppercase tracking-wider shadow-lg hover:brightness-110 transition-all"
              style={{ backgroundColor: '#D40046', color: 'white' }}
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
              className="hover:brightness-110 text-white w-full"
              style={{ backgroundColor: '#D40046' }}
              data-testid="button-accept-terms"
            >
              I Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeposit} onOpenChange={setShowDeposit}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-white/10 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-accent" />
              Pay Entry Fee
            </DialogTitle>
            <DialogDescription>
              Add funds to your game balance
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Amount (USDC)</Label>
              <div className="flex gap-2">
                {['1', '5', '10', '20'].map(amt => (
                  <Button
                    key={amt}
                    type="button"
                    variant={depositAmount === amt ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDepositAmount(amt)}
                    className="flex-1"
                  >
                    ${amt}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="Custom amount"
                min="1"
                step="0.01"
                className="mt-2"
                data-testid="input-deposit-amount"
              />
            </div>
            
            <div className="text-xs text-gray-500">
              Funds will be added to your game balance instantly.
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={handleDeposit}
              disabled={isProcessing || !depositAmount || !Number.isFinite(parseFloat(depositAmount)) || parseFloat(depositAmount) <= 0}
              className="w-full"
              data-testid="button-confirm-deposit"
            >
              {isProcessing ? 'Processing...' : `Deposit $${depositAmount || '0'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showWithdraw} onOpenChange={setShowWithdraw}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-white/10 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpFromLine className="w-5 h-5 text-accent" />
              Withdraw USDC
            </DialogTitle>
            <DialogDescription>
              Transfer funds to your wallet
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-black/30 p-3 rounded-lg">
              <div className="text-xs text-gray-400">Available Balance</div>
              <div className="text-xl font-bold text-accent">
                ${internalBalance?.availableUsd || '0.00'}
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Amount to withdraw (USDC)</Label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="Min $1.00"
                max={internalBalance?.availableCents ? internalBalance.availableCents / 100 : 0}
                min="1.00"
                step="0.01"
                data-testid="input-withdraw-amount"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Minimum $1.00</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setWithdrawAmount(internalBalance?.availableUsd || '0')}
                  className="text-xs text-accent h-auto py-0"
                >
                  Withdraw All
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={handleWithdraw}
              disabled={isProcessing || !withdrawAmount || !Number.isFinite(parseFloat(withdrawAmount)) || parseFloat(withdrawAmount) < 1.00}
              className="w-full"
              data-testid="button-confirm-withdraw"
            >
              {isProcessing ? 'Processing...' : `Withdraw $${withdrawAmount || '0'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-white/10 sm:max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-accent" />
              Transaction History
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            {transactions.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map(tx => (
                  <div key={tx.id} className="bg-black/30 p-3 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        tx.type === 'DEPOSIT' ? 'bg-green-500/20 text-green-400' :
                        tx.type === 'WITHDRAWAL' ? 'bg-red-500/20 text-red-400' :
                        tx.type === 'PRIZE_PAYOUT' ? 'bg-yellow-500/20 text-yellow-400' :
                        tx.type === 'MATCH_LOCK' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {tx.type.replace('_', ' ')}
                      </span>
                      <span className={`font-mono text-sm ${
                        tx.deltaAvailable > 0 ? 'text-green-400' : 
                        tx.deltaAvailable < 0 ? 'text-red-400' : 'text-gray-400'
                      }`}>
                        {tx.deltaAvailable > 0 ? '+' : ''}{(tx.deltaAvailable / 100).toFixed(2)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(tx.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showMobileLeaderboard} onOpenChange={setShowMobileLeaderboard}>
        <DialogContent className="bg-card/95 backdrop-blur-xl border-white/10 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-400" />
              Top Weekly Players
              {mockLeaderboardEnabled && (
                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">PREVIEW</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {(mockLeaderboardEnabled ? MOCK_LEADERBOARD : weeklyLeaderboard).slice(0, 10).map((player, index) => (
              <div 
                key={index}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 text-center font-bold ${
                    index === 0 ? 'text-yellow-400' : 
                    index === 1 ? 'text-gray-300' : 
                    index === 2 ? 'text-amber-600' : 'text-gray-500'
                  }`}>
                    {index + 1}
                  </span>
                  <span className="text-white font-mono text-xs">{player.wallet.slice(0, 4)}...{player.wallet.slice(-4)}</span>
                </div>
                <span className="text-green-400 font-mono font-bold">{player.earnedUsd} USDC</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 text-center italic">
            Based on in-game performance. Displayed amounts are not guaranteed. No refunds.
          </p>
        </DialogContent>
      </Dialog>

      {/* Tutorial Dialog */}
      <Dialog open={showTutorial} onOpenChange={handleTutorialSkip}>
        <DialogContent className="bg-[#0d0d1a] border-white/10 sm:max-w-md p-0 overflow-hidden gap-0">
          {/* Progress bar */}
          <div className="h-0.5 bg-white/5 w-full">
            <div className="h-full bg-[#D40046] transition-all duration-300" style={{ width: `${((tutorialStep + 1) / 5) * 100}%` }} />
          </div>

          <div className="p-6">
            {tutorialStep === 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-[#D40046]/20 flex items-center justify-center">
                    <Target className="w-5 h-5 text-[#D40046]" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight font-mono">Welcome to Orbit Arena</h2>
                    <p className="text-xs text-gray-500">Quick start — 4 steps</p>
                  </div>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">
                  Real-time multiplayer combat. Pick your shape, collect pickups, and eliminate opponents to be the last one standing.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="text-2xl mb-1">❤️</div>
                    <p className="text-xs font-semibold text-white">HP System</p>
                    <p className="text-[11px] text-gray-500">Start at 100 HP. Die at 0.</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="text-2xl mb-1">⚡</div>
                    <p className="text-xs font-semibold text-white">Energy System</p>
                    <p className="text-[11px] text-gray-500">Build energy. Use abilities.</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="flex justify-center mb-1.5">
                      <div className="w-5 h-5 bg-[#00CC7A]" />
                    </div>
                    <p className="text-xs font-semibold text-white">HP Pickups</p>
                    <p className="text-[11px] text-gray-500">Green square — +5 HP</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 text-center">
                    <div className="flex justify-center mb-1.5">
                      <svg viewBox="0 0 20 16" className="w-5 h-4"><polygon points="10,1 19,15 1,15" fill="#D40046"/></svg>
                    </div>
                    <p className="text-xs font-semibold text-white">Energy Pickups</p>
                    <p className="text-[11px] text-gray-500">Red triangle — +5 energy</p>
                  </div>
                </div>
              </div>
            )}

            {tutorialStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Gamepad2 className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight font-mono">Controls</h2>
                    <p className="text-xs text-gray-500">Desktop &amp; Mobile</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                    <div className="text-xs font-mono bg-white/10 rounded px-2 py-1 text-white shrink-0">Move Mouse</div>
                    <p className="text-xs text-gray-300">Your character follows your cursor</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                    <div className="text-xs font-mono bg-white/10 rounded px-2 py-1 text-white shrink-0">Right Click</div>
                    <p className="text-xs text-gray-300">Ability 1 (costs 20 energy)</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                    <div className="text-xs font-mono bg-white/10 rounded px-2 py-1 text-white shrink-0">Left Click</div>
                    <p className="text-xs text-gray-300">Ability 2 (costs 20 energy)</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                    <div className="text-xs font-mono bg-white/10 rounded px-2 py-1 text-white shrink-0">Q key</div>
                    <p className="text-xs text-gray-300">Leave the game (free mode only)</p>
                  </div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                  <p className="text-xs text-blue-300 font-semibold mb-1">📱 On Mobile / Tablet</p>
                  <p className="text-xs text-gray-400">Joystick = move · Hold top button = Ability 1 · Tap bottom button = Ability 2</p>
                </div>
              </div>
            )}

            {tutorialStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight font-mono">Character Shapes</h2>
                    <p className="text-xs text-gray-500">Each has 2 unique abilities</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0"><circle cx="10" cy="10" r="8" fill="none" stroke="#60a5fa" strokeWidth="2"/></svg>
                      <span className="text-sm font-bold text-white">Circle</span>
                      <span className="text-[10px] text-gray-500 ml-auto">Crowd Control</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[11px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Pull — drag enemies toward you</span>
                      <span className="text-[11px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Slam — area damage around you</span>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0"><polygon points="10,2 18,18 2,18" fill="none" stroke="#34d399" strokeWidth="2"/></svg>
                      <span className="text-sm font-bold text-white">Triangle</span>
                      <span className="text-[10px] text-gray-500 ml-auto">Aggression</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[11px] bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">Dash — quick forward burst</span>
                      <span className="text-[11px] bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">Shoot — projectile in your direction</span>
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <svg viewBox="0 0 20 20" className="w-5 h-5 shrink-0"><rect x="3" y="3" width="14" height="14" fill="none" stroke="#f59e0b" strokeWidth="2"/></svg>
                      <span className="text-sm font-bold text-white">Square</span>
                      <span className="text-[10px] text-gray-500 ml-auto">Defense</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <span className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">Push — shove enemies away</span>
                      <span className="text-[11px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">Stun Wave — stun nearby enemies</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tutorialStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight font-mono">Elite Mode & Scoring</h2>
                    <p className="text-xs text-gray-500">Get kills. Get stronger.</p>
                  </div>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-orange-400 font-black text-lg">⚡</span>
                    <p className="text-sm font-bold text-orange-300">Get 2 kills → ELITE MODE activates</p>
                  </div>
                  <div className="space-y-1.5 pl-1">
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      +30% movement speed
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      All abilities become more powerful
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                      1.5× score earned per damage dealt
                    </div>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-bold text-white uppercase tracking-wide">How Scoring Works</p>
                  <p className="text-xs text-gray-400 leading-relaxed">Your score is based on <span className="text-white">damage you deal</span>, not just kills. The more you hit, the higher you rank — even without eliminating anyone.</p>
                  <p className="text-xs text-gray-400 leading-relaxed">In Solana Mode, the <span className="text-white">top 3 players by score</span> at the end of the round share the prize pool.</p>
                </div>
              </div>
            )}

            {tutorialStep === 4 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight font-mono">Game Modes</h2>
                    <p className="text-xs text-gray-500">Choose how you play</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Gamepad2 className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-bold text-white">Free Mode</span>
                      <span className="text-[10px] bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full ml-auto">No cost</span>
                    </div>
                    <p className="text-xs text-gray-400">Jump straight in. No wallet needed. Play as long as you want, leave anytime. Great for practice.</p>
                  </div>
                  <div className="bg-[#D40046]/5 border border-[#D40046]/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Coins className="w-4 h-4 text-[#D40046]" />
                      <span className="text-sm font-bold text-white">Solana Mode</span>
                      <span className="text-[10px] bg-[#D40046]/20 text-[#D40046] px-2 py-0.5 rounded-full ml-auto">$1 USDC entry</span>
                    </div>
                    <p className="text-xs text-gray-400">Pay $1 USDC to enter. 6–15 players compete. Top 3 split the prize pool — up to <span className="text-white font-semibold">$6 for 1st place</span>. Requires a Phantom wallet.</p>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-400">You can always re-open this guide from the <span className="text-white font-semibold">?</span> button in the lobby — <span className="text-green-400 font-semibold">good luck out there!</span></p>
                </div>
              </div>
            )}
          </div>

          {/* Step dots + buttons */}
          <div className="px-6 pb-5 flex items-center justify-between">
            <div className="flex gap-1.5">
              {[0,1,2,3,4].map(i => (
                <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === tutorialStep ? 'bg-white w-4' : 'bg-white/20'}`} />
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleTutorialSkip} className="text-gray-500 text-xs h-8 px-3">
                Skip
              </Button>
              <Button size="sm" onClick={handleTutorialNext} className="bg-[#D40046] hover:bg-[#b5003c] text-white h-8 px-4 gap-1.5 text-xs font-semibold" data-testid="button-tutorial-next">
                {tutorialStep < 4 ? <><span>Next</span><ChevronRight className="w-3.5 h-3.5" /></> : 'Play Now'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AdminPanel
        onMockLeaderboard={setMockLeaderboardEnabled}
        mockLeaderboardEnabled={mockLeaderboardEnabled}
      />
    </div>
  );
}
