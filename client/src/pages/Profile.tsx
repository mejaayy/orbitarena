import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Trophy, Target, Swords, TrendingUp, Wallet, ArrowDownLeft, ArrowUpRight, Lock, Coins, RefreshCw, ChevronDown } from 'lucide-react';

type TxType = 'DEPOSIT' | 'WITHDRAWAL' | 'MATCH_LOCK' | 'MATCH_UNLOCK' | 'PRIZE_PAYOUT';

interface Transaction {
  id: string;
  type: TxType;
  deltaAvailable: number;
  deltaLocked: number;
  createdAt: string;
  metadata: any;
}

interface StatsData {
  totalKills: number;
  totalGames: number;
  totalWins: number;
  lifetimePrizeCents: number;
  lifetimeDepositedCents: number;
  lifetimeWithdrawnCents: number;
}

interface ProfileData {
  walletAddress: string;
  stats: StatsData;
  transactions: Transaction[];
}

const TX_LABELS: Record<TxType, { label: string; color: string; icon: React.ReactNode }> = {
  DEPOSIT: { label: 'Deposit', color: 'text-green-400', icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
  WITHDRAWAL: { label: 'Withdrawal', color: 'text-orange-400', icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
  MATCH_LOCK: { label: 'Entry Fee', color: 'text-yellow-400', icon: <Lock className="w-3.5 h-3.5" /> },
  MATCH_UNLOCK: { label: 'Refund', color: 'text-blue-400', icon: <ArrowDownLeft className="w-3.5 h-3.5" /> },
  PRIZE_PAYOUT: { label: 'Prize', color: 'text-accent', icon: <Trophy className="w-3.5 h-3.5" /> },
};

function formatCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : '+'}$${(abs / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortWallet(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export default function Profile() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const wallet = (() => {
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('wallet');
    if (fromParam) return fromParam;
    try {
      const session = JSON.parse(sessionStorage.getItem('orbit-arena-session') || '{}');
      return session.wallet || null;
    } catch { return null; }
  })();

  const fetchData = async () => {
    if (!wallet) { setError('No wallet connected'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stats/${wallet}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [wallet]);

  const winRate = data?.stats.totalGames
    ? Math.round((data.stats.totalWins / data.stats.totalGames) * 100)
    : 0;

  const displayedTxs = data
    ? (showAll ? data.transactions : data.transactions.slice(0, 10))
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-6">

        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/')}
            data-testid="button-back"
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wide">Player Profile</h1>
            {wallet && (
              <div className="flex items-center gap-1.5 text-gray-400 text-sm">
                <Wallet className="w-3.5 h-3.5" />
                <span data-testid="text-wallet-address">{shortWallet(wallet)}</span>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchData}
            className="ml-auto text-gray-400 hover:text-white"
            data-testid="button-refresh"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {error && (
          <div className="bg-destructive/20 border border-destructive/50 rounded-lg p-4 mb-6 text-center text-sm" data-testid="text-error">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center py-20 text-gray-500" data-testid="loading-spinner">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading...
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-6">
              <StatCard
                icon={<Trophy className="w-5 h-5 text-yellow-400" />}
                label="Stake Wins"
                value={data.stats.totalWins.toString()}
                testId="stat-wins"
              />
              <StatCard
                icon={<TrendingUp className="w-5 h-5 text-green-400" />}
                label="Win Rate"
                value={data.stats.totalGames > 0 ? `${winRate}%` : 'N/A'}
                sub={data.stats.totalGames > 0 ? `${data.stats.totalGames} games` : 'No games yet'}
                testId="stat-winrate"
              />
              <StatCard
                icon={<Swords className="w-5 h-5 text-red-400" />}
                label="Total Kills"
                value={data.stats.totalKills.toString()}
                testId="stat-kills"
              />
              <StatCard
                icon={<Target className="w-5 h-5 text-blue-400" />}
                label="Stake Rounds"
                value={data.stats.totalGames.toString()}
                testId="stat-games"
              />
            </div>

            <div className="bg-card/60 border border-white/10 rounded-xl p-4 mb-6">
              <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5" /> Lifetime USDC
              </h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Deposited</div>
                  <div className="text-sm font-mono font-bold text-green-400" data-testid="stat-deposited">
                    ${(data.stats.lifetimeDepositedCents / 100).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Prizes Won</div>
                  <div className="text-sm font-mono font-bold text-accent" data-testid="stat-prizes">
                    ${(data.stats.lifetimePrizeCents / 100).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Withdrawn</div>
                  <div className="text-sm font-mono font-bold text-orange-400" data-testid="stat-withdrawn">
                    ${(data.stats.lifetimeWithdrawnCents / 100).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                Transaction History
                <span className="text-gray-600 text-xs font-normal normal-case tracking-normal">
                  ({data.transactions.length} total)
                </span>
              </h2>

              {data.transactions.length === 0 ? (
                <div className="text-center py-10 text-gray-600 text-sm" data-testid="text-no-transactions">
                  No transactions yet. Deposit USDC to get started!
                </div>
              ) : (
                <div className="space-y-2" data-testid="transaction-list">
                  {displayedTxs.map((tx) => {
                    const config = TX_LABELS[tx.type] || { label: tx.type, color: 'text-gray-400', icon: null };
                    const delta = tx.deltaAvailable;
                    const isPositive = delta > 0;
                    const rank = tx.metadata?.rank;
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between bg-card/40 border border-white/5 hover:border-white/10 rounded-lg px-4 py-3 transition-colors"
                        data-testid={`tx-row-${tx.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`${config.color}`}>{config.icon}</div>
                          <div>
                            <div className={`text-sm font-semibold ${config.color}`}>
                              {config.label}
                              {rank ? ` — #${rank} Place` : ''}
                            </div>
                            <div className="text-xs text-gray-500">{formatDate(tx.createdAt)}</div>
                          </div>
                        </div>
                        <div className={`text-sm font-mono font-bold ${isPositive ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                          {delta !== 0 ? formatCents(delta) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {data.transactions.length > 10 && !showAll && (
                <Button
                  variant="ghost"
                  className="w-full mt-3 text-gray-400 hover:text-white gap-1.5 text-sm"
                  onClick={() => setShowAll(true)}
                  data-testid="button-show-more"
                >
                  <ChevronDown className="w-4 h-4" /> Show all {data.transactions.length} transactions
                </Button>
              )}
            </div>
          </>
        )}

        <div className="mt-8 p-4 bg-accent/5 border border-accent/20 rounded-xl text-center">
          <div className="text-xs text-gray-400 leading-relaxed">
            Your USDC balance is stored securely and persists between sessions. Closing your browser never affects your funds. Note: entry fees are non-refundable once a round begins.
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, sub, testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}) {
  return (
    <div className="bg-card/60 border border-white/10 rounded-xl p-4 flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className="text-3xl font-mono font-black">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
