import React, { useState, useEffect } from 'react';
import { Settings, X, Eye, EyeOff, Trash2, RefreshCw, Trophy, Lock, AlertTriangle, Ban, Shield, Snowflake, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface AdminPanelProps {
  onMockLeaderboard: (enabled: boolean) => void;
  mockLeaderboardEnabled: boolean;
}

interface BannedWallet {
  walletAddress: string;
  reason: string;
  bannedAt: string;
}

interface Alert {
  walletAddress: string;
  playerName: string;
  streak: number;
  alertCount: number;
  isCritical: boolean;
}

const ADMIN_PASSWORD_KEY = 'orbit-arena-admin-password';

export function AdminPanel({ onMockLeaderboard, mockLeaderboardEnabled }: AdminPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'general' | 'bans' | 'alerts'>('general');
  const [bannedWallets, setBannedWallets] = useState<BannedWallet[]>([]);
  const [banWalletInput, setBanWalletInput] = useState('');
  const [banReasonInput, setBanReasonInput] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [leaderboardFrozen, setLeaderboardFrozen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    setHasPassword(!!savedPassword);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBannedWallets();
      fetchAlerts();
      fetchSettings();
    }
  }, [isAuthenticated]);

  const fetchBannedWallets = async () => {
    try {
      const res = await fetch('/api/admin/banned');
      const data = await res.json();
      setBannedWallets(data.wallets || []);
    } catch (e) {
      console.error('Failed to fetch banned wallets');
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/admin/alerts');
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (e) {
      console.error('Failed to fetch alerts');
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      setLeaderboardFrozen(data.leaderboardFrozen === true);
    } catch (e) {
      console.error('Failed to fetch settings');
    }
  };

  const handleBanWallet = async () => {
    if (!banWalletInput || banWalletInput.length < 32) {
      setError('Enter a valid wallet address');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: banWalletInput, reason: banReasonInput || 'Banned by admin' }),
      });
      if (res.ok) {
        setBanWalletInput('');
        setBanReasonInput('');
        await fetchBannedWallets();
      }
    } catch (e) {
      setError('Failed to ban wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnbanWallet = async (walletAddress: string) => {
    setIsLoading(true);
    try {
      await fetch('/api/admin/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      await fetchBannedWallets();
    } catch (e) {
      console.error('Failed to unban wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetLeaderboard = async () => {
    if (!confirm('Are you sure you want to reset the weekly leaderboard? This cannot be undone.')) {
      return;
    }
    setIsLoading(true);
    try {
      await fetch('/api/admin/leaderboard/reset', { method: 'POST' });
      alert('Leaderboard reset successfully');
    } catch (e) {
      setError('Failed to reset leaderboard');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFreezeLeaderboard = async (frozen: boolean) => {
    setIsLoading(true);
    try {
      await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'leaderboardFrozen', value: frozen }),
      });
      setLeaderboardFrozen(frozen);
    } catch (e) {
      setError('Failed to update setting');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearAlerts = async () => {
    if (!confirm('Clear all win streak alerts?')) return;
    setIsLoading(true);
    try {
      await fetch('/api/admin/alerts/clear', { method: 'POST' });
      await fetchAlerts();
    } catch (e) {
      console.error('Failed to clear alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPassword = () => {
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    localStorage.setItem(ADMIN_PASSWORD_KEY, password);
    setHasPassword(true);
    setIsAuthenticated(true);
    setError('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleLogin = () => {
    const savedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    if (password === savedPassword) {
      setIsAuthenticated(true);
      setError('');
      setPassword('');
    } else {
      setError('Incorrect password');
    }
  };

  const handleChangePassword = () => {
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    localStorage.setItem(ADMIN_PASSWORD_KEY, password);
    setShowChangePassword(false);
    setError('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleClearLocalStorage = () => {
    const adminPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    localStorage.clear();
    if (adminPassword) {
      localStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
    }
    window.location.reload();
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsAuthenticated(false);
    setPassword('');
    setConfirmPassword('');
    setError('');
    setShowChangePassword(false);
    setActiveTab('general');
  };

  const criticalAlertCount = alerts.filter(a => a.isCritical).length;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed top-4 right-4 z-[9999] p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full border border-white/10 transition-colors"
        style={{ position: 'fixed', top: '16px', right: '16px' }}
        data-testid="admin-panel-toggle"
      >
        <Settings className="w-5 h-5 text-gray-400" />
        {alerts.length > 0 && (
          <span className={`absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold rounded-full flex items-center justify-center ${
            criticalAlertCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
          }`}>
            {alerts.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed z-[9999] w-96 max-h-[80vh] bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col" style={{ position: 'fixed', top: '16px', right: '16px' }} data-testid="admin-panel">
      <div className="flex items-center justify-between p-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <span className="font-bold text-white text-sm">Admin Panel</span>
          {alerts.length > 0 && (
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
              criticalAlertCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {alerts.length} alert{alerts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={handleClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        {!isAuthenticated ? (
          <div className="space-y-4">
            {!hasPassword ? (
              <>
                <p className="text-sm text-gray-400">Set up your admin password:</p>
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="New password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-gray-800 border-gray-700 pr-10"
                      data-testid="admin-new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-gray-800 border-gray-700"
                    data-testid="admin-confirm-password"
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <Button onClick={handleSetPassword} className="w-full" data-testid="admin-set-password">
                  <Lock className="w-4 h-4 mr-2" />
                  Set Password
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400">Enter admin password:</p>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    className="bg-gray-800 border-gray-700 pr-10"
                    data-testid="admin-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <Button onClick={handleLogin} className="w-full" data-testid="admin-login">
                  Unlock
                </Button>
              </>
            )}
          </div>
        ) : showChangePassword ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">Change admin password:</p>
            <div className="space-y-2">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-800 border-gray-700"
              />
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-gray-800 border-gray-700"
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => setShowChangePassword(false)} variant="outline" className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleChangePassword} className="flex-1">
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-1 p-1 bg-gray-800/50 rounded-lg">
              <button
                onClick={() => setActiveTab('general')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  activeTab === 'general' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                General
              </button>
              <button
                onClick={() => setActiveTab('bans')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                  activeTab === 'bans' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Bans
              </button>
              <button
                onClick={() => setActiveTab('alerts')}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors relative ${
                  activeTab === 'alerts' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Alerts
                {alerts.length > 0 && (
                  <span className={`absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold rounded-full flex items-center justify-center ${
                    criticalAlertCount > 0 ? 'bg-red-500' : 'bg-yellow-500'
                  }`}>
                    {alerts.length}
                  </span>
                )}
              </button>
            </div>

            {activeTab === 'general' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    <Label className="text-sm text-white">Mock Leaderboard</Label>
                  </div>
                  <Switch
                    checked={mockLeaderboardEnabled}
                    onCheckedChange={onMockLeaderboard}
                    data-testid="admin-mock-leaderboard-toggle"
                  />
                </div>
                <p className="text-xs text-gray-500 -mt-2 ml-1">
                  Shows sample data in the weekly leaderboard
                </p>

                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Snowflake className="w-4 h-4 text-blue-400" />
                    <Label className="text-sm text-white">Freeze Leaderboard</Label>
                  </div>
                  <Switch
                    checked={leaderboardFrozen}
                    onCheckedChange={handleFreezeLeaderboard}
                    disabled={isLoading}
                  />
                </div>
                <p className="text-xs text-gray-500 -mt-2 ml-1">
                  Stops updating the leaderboard (keeps display)
                </p>

                <Button
                  onClick={handleResetLeaderboard}
                  variant="outline"
                  className="w-full justify-start text-red-400 border-red-400/30 hover:bg-red-400/10"
                  disabled={isLoading}
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reset Weekly Leaderboard
                </Button>

                <div className="border-t border-white/10 pt-4 space-y-2">
                  <Button
                    onClick={handleClearLocalStorage}
                    variant="outline"
                    className="w-full justify-start text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear Local Storage
                  </Button>

                  <Button
                    onClick={() => window.location.reload()}
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Page
                  </Button>

                  <Button
                    onClick={() => setShowChangePassword(true)}
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Change Password
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'bans' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-gray-400">Ban Wallet</Label>
                  <Input
                    placeholder="Wallet address"
                    value={banWalletInput}
                    onChange={(e) => setBanWalletInput(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-xs font-mono"
                  />
                  <Input
                    placeholder="Reason (optional)"
                    value={banReasonInput}
                    onChange={(e) => setBanReasonInput(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-xs"
                  />
                  <Button
                    onClick={handleBanWallet}
                    className="w-full bg-red-600 hover:bg-red-700"
                    disabled={isLoading}
                  >
                    <Ban className="w-4 h-4 mr-2" />
                    Ban Wallet
                  </Button>
                </div>

                {error && <p className="text-red-400 text-xs">{error}</p>}

                <div className="border-t border-white/10 pt-4">
                  <Label className="text-xs text-gray-400 mb-2 block">Banned Wallets ({bannedWallets.length})</Label>
                  {bannedWallets.length === 0 ? (
                    <p className="text-gray-500 text-xs">No banned wallets</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {bannedWallets.map((w) => (
                        <div key={w.walletAddress} className="flex items-center justify-between p-2 bg-gray-800/50 rounded text-xs">
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-white truncate">{w.walletAddress.slice(0, 12)}...{w.walletAddress.slice(-8)}</p>
                            <p className="text-gray-500 text-[10px]">{w.reason}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleUnbanWallet(w.walletAddress)}
                            className="text-green-400 hover:text-green-300 ml-2"
                            disabled={isLoading}
                          >
                            <Shield className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'alerts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={`w-4 h-4 ${criticalAlertCount > 0 ? 'text-red-500' : 'text-yellow-400'}`} />
                    <Label className="text-sm text-white">Win Streak Alerts</Label>
                  </div>
                  {alerts.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleClearAlerts}
                      className="text-gray-400 hover:text-white text-xs"
                      disabled={isLoading}
                    >
                      Clear All
                    </Button>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  Players who won 5+ times in a row. Red = triggered twice.
                </p>

                {alerts.length === 0 ? (
                  <div className="text-center py-6 text-gray-500 text-sm">
                    No alerts
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {alerts.map((alert) => (
                      <div
                        key={alert.walletAddress}
                        className={`p-3 rounded-lg border ${
                          alert.isCritical
                            ? 'bg-red-500/10 border-red-500/30'
                            : 'bg-yellow-500/10 border-yellow-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-white text-sm">{alert.playerName}</span>
                          <span className={`px-2 py-0.5 text-xs font-bold rounded ${
                            alert.isCritical ? 'bg-red-500 text-white' : 'bg-yellow-500 text-black'
                          }`}>
                            {alert.streak} WINS
                          </span>
                        </div>
                        <p className="text-xs font-mono text-gray-400 truncate">
                          {alert.walletAddress}
                        </p>
                        <p className={`text-xs mt-1 ${alert.isCritical ? 'text-red-400' : 'text-yellow-400'}`}>
                          Alert triggered {alert.alertCount} time{alert.alertCount > 1 ? 's' : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
