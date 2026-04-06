import React, { useState, useEffect } from 'react';
import { Settings, X, Eye, EyeOff, Trash2, RefreshCw, Trophy, Lock, AlertTriangle, Ban, Shield, Snowflake, RotateCcw, LogOut, Volume2, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { soundManager } from '@/game/SoundManager';
import { proceduralMusic } from '@/game/ProceduralMusic';

interface AdminPanelProps {
  onMockLeaderboard: (enabled: boolean) => void;
  mockLeaderboardEnabled: boolean;
  position?: 'top-right' | 'bottom-right';
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

interface RpcStatus {
  totalErrors: number;
  fallbackActivations: number;
  windowMinutes: number;
  isUnderPressure: boolean;
  isCritical: boolean;
  lastErrorAt: number | null;
}

const ADMIN_TOKEN_KEY = 'orbit-arena-admin-token';

export function AdminPanel({ onMockLeaderboard, mockLeaderboardEnabled, position = 'top-right' }: AdminPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'general' | 'bans' | 'alerts'>('general');
  const [bannedWallets, setBannedWallets] = useState<BannedWallet[]>([]);
  const [banWalletInput, setBanWalletInput] = useState('');
  const [banReasonInput, setBanReasonInput] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [rpcStatus, setRpcStatus] = useState<RpcStatus | null>(null);
  const [leaderboardFrozen, setLeaderboardFrozen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(proceduralMusic.enabled);
  const [pickupSoundsEnabled, setPickupSoundsEnabled] = useState(soundManager.pickupSoundsEnabled);
  const [abilitySoundsEnabled, setAbilitySoundsEnabled] = useState(soundManager.abilitySoundsEnabled);
  const [trainingMode, setTrainingMode] = useState(false);

  const getAuthToken = () => sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const setAuthToken = (token: string) => sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  const clearAuthToken = () => sessionStorage.removeItem(ADMIN_TOKEN_KEY);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'X-Admin-Token': getAuthToken() || '',
  });

  useEffect(() => {
    checkAuthStatus();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBannedWallets();
      fetchAlerts();
      fetchRpcStatus();
      fetchSettings();
      fetchTrainingMode();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !isOpen) return;
    const interval = setInterval(fetchRpcStatus, 30_000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isOpen]);

  const checkAuthStatus = async () => {
    setIsCheckingAuth(true);
    try {
      const res = await fetch('/api/admin/auth/status');
      const data = await res.json();
      setHasPassword(data.hasPassword);
      
      const token = getAuthToken();
      if (token && data.hasPassword) {
        const testRes = await fetch('/api/admin/settings', {
          headers: authHeaders(),
        });
        if (testRes.ok) {
          setIsAuthenticated(true);
        } else {
          clearAuthToken();
        }
      }
    } catch (e) {
      console.error('Failed to check auth status');
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const fetchBannedWallets = async () => {
    try {
      const res = await fetch('/api/admin/banned', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setBannedWallets(data.wallets || []);
      }
    } catch (e) {
      console.error('Failed to fetch banned wallets');
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/admin/alerts', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts || []);
      }
    } catch (e) {
      console.error('Failed to fetch alerts');
    }
  };

  const fetchRpcStatus = async () => {
    try {
      const res = await fetch('/api/admin/rpc-status', { headers: authHeaders() });
      if (res.ok) {
        setRpcStatus(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch RPC status');
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setLeaderboardFrozen(data.leaderboardFrozen === true);
      }
    } catch (e) {
      console.error('Failed to fetch settings');
    }
  };

  const fetchTrainingMode = async () => {
    try {
      const res = await fetch('/api/admin/training', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTrainingMode(data.enabled === true);
      }
    } catch (e) {
      console.error('Failed to fetch training mode');
    }
  };

  const handleToggleTrainingMode = async (enabled: boolean) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/training', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setTrainingMode(data.enabled);
      } else if (res.status === 401) {
        handleSessionExpired();
      }
    } catch (e) {
      setError('Failed to toggle training mode');
    } finally {
      setIsLoading(false);
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
        headers: authHeaders(),
        body: JSON.stringify({ walletAddress: banWalletInput, reason: banReasonInput || 'Banned by admin' }),
      });
      if (res.ok) {
        setBanWalletInput('');
        setBanReasonInput('');
        await fetchBannedWallets();
      } else if (res.status === 401) {
        handleSessionExpired();
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
      const res = await fetch('/api/admin/unban', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ walletAddress }),
      });
      if (res.ok) {
        await fetchBannedWallets();
      } else if (res.status === 401) {
        handleSessionExpired();
      }
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
      const res = await fetch('/api/admin/leaderboard/reset', { 
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.ok) {
        alert('Leaderboard reset successfully');
      } else if (res.status === 401) {
        handleSessionExpired();
      }
    } catch (e) {
      setError('Failed to reset leaderboard');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFreezeLeaderboard = async (frozen: boolean) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ key: 'leaderboardFrozen', value: frozen }),
      });
      if (res.ok) {
        setLeaderboardFrozen(frozen);
      } else if (res.status === 401) {
        handleSessionExpired();
      }
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
      const res = await fetch('/api/admin/alerts/clear', { 
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.ok) {
        await fetchAlerts();
      } else if (res.status === 401) {
        handleSessionExpired();
      }
    } catch (e) {
      console.error('Failed to clear alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetPassword = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      if (res.ok && data.token) {
        setAuthToken(data.token);
        setHasPassword(true);
        setIsAuthenticated(true);
        setError('');
        setPassword('');
        setConfirmPassword('');
      } else {
        setError(data.error || 'Failed to set password');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      const data = await res.json();
      if (res.ok && data.token) {
        setAuthToken(data.token);
        setIsAuthenticated(true);
        setError('');
        setPassword('');
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth/logout', {
        method: 'POST',
        headers: authHeaders(),
      });
    } catch (e) {
      console.error('Logout error');
    } finally {
      clearAuthToken();
      setIsAuthenticated(false);
      setActiveTab('general');
    }
  };

  const handleSessionExpired = () => {
    clearAuthToken();
    setIsAuthenticated(false);
    setError('Session expired. Please log in again.');
  };

  const handleChangePassword = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/auth/change-password', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ password }),
      });
      
      if (res.ok) {
        setShowChangePassword(false);
        setError('');
        setPassword('');
        setConfirmPassword('');
        alert('Password changed successfully');
      } else if (res.status === 401) {
        handleSessionExpired();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to change password');
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearLocalStorage = () => {
    const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    localStorage.clear();
    if (adminToken) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
    }
    window.location.reload();
  };

  const handleClose = () => {
    setIsOpen(false);
    setPassword('');
    setConfirmPassword('');
    setError('');
    setShowChangePassword(false);
    setActiveTab('general');
  };

  const criticalAlertCount = alerts.filter(a => a.isCritical).length;
  const rpcHasIssues = rpcStatus?.isUnderPressure || rpcStatus?.isCritical;
  const totalAlertBadge = alerts.length + (rpcHasIssues ? 1 : 0);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed z-[9999] p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full border border-white/10 transition-colors"
        style={{ position: 'fixed', right: '16px', ...(position === 'bottom-right' ? { bottom: '16px' } : { top: '16px' }) }}
        data-testid="admin-panel-toggle"
      >
        <Settings className="w-5 h-5 text-gray-400" />
        {isAuthenticated && totalAlertBadge > 0 && (
          <span className={`absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold rounded-full flex items-center justify-center ${
            criticalAlertCount > 0 || rpcStatus?.isCritical ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
          }`}>
            {totalAlertBadge}
          </span>
        )}
      </button>
    );
  }

  if (isCheckingAuth) {
    return (
      <div className="fixed z-[9999] w-96 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl p-6" style={{ position: 'fixed', right: '16px', ...(position === 'bottom-right' ? { bottom: '16px' } : { top: '16px' }) }}>
        <div className="text-center text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="fixed z-[9999] w-96 max-h-[80vh] bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl flex flex-col" style={{ position: 'fixed', right: '16px', ...(position === 'bottom-right' ? { bottom: '16px' } : { top: '16px' }) }} data-testid="admin-panel">
      <div className="flex items-center justify-between p-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <span className="font-bold text-white text-sm">Settings</span>
          {isAuthenticated && alerts.length > 0 && (
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
              criticalAlertCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {alerts.length} alert{alerts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isAuthenticated && (
            <button onClick={handleLogout} className="text-gray-400 hover:text-white p-1" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          )}
          <button onClick={handleClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 overflow-y-auto flex-1">
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-gray-400" />
            <span className="text-xs uppercase tracking-widest text-gray-500 font-medium">Sound</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Background Music</span>
            <Switch
              checked={musicEnabled}
              onCheckedChange={(checked) => {
                setMusicEnabled(checked);
                proceduralMusic.enabled = checked;
                localStorage.setItem('orbit-arena-music', String(checked));
                if (!checked) proceduralMusic.stop();
              }}
              data-testid="switch-music"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Pickup Sounds</span>
            <Switch
              checked={pickupSoundsEnabled}
              onCheckedChange={(checked) => {
                setPickupSoundsEnabled(checked);
                soundManager.pickupSoundsEnabled = checked;
                localStorage.setItem('orbit-arena-pickup-sounds', String(checked));
              }}
              data-testid="switch-pickup-sounds"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Ability Sounds</span>
            <Switch
              checked={abilitySoundsEnabled}
              onCheckedChange={(checked) => {
                setAbilitySoundsEnabled(checked);
                soundManager.abilitySoundsEnabled = checked;
                localStorage.setItem('orbit-arena-ability-sounds', String(checked));
              }}
              data-testid="switch-ability-sounds"
            />
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-gray-400" />
            <span className="text-xs uppercase tracking-widest text-gray-500 font-medium">Admin</span>
          </div>
        </div>

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
                      disabled={isLoading}
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
                    disabled={isLoading}
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <Button onClick={handleSetPassword} className="w-full" disabled={isLoading} data-testid="admin-set-password">
                  <Lock className="w-4 h-4 mr-2" />
                  {isLoading ? 'Setting up...' : 'Set Password'}
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
                    disabled={isLoading}
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
                <Button onClick={handleLogin} className="w-full" disabled={isLoading} data-testid="admin-login">
                  {isLoading ? 'Logging in...' : 'Unlock'}
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
                disabled={isLoading}
              />
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-gray-800 border-gray-700"
                disabled={isLoading}
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={() => setShowChangePassword(false)} variant="outline" className="flex-1" disabled={isLoading}>
                Cancel
              </Button>
              <Button onClick={handleChangePassword} className="flex-1" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save'}
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
                {totalAlertBadge > 0 && (
                  <span className={`absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold rounded-full flex items-center justify-center ${
                    criticalAlertCount > 0 || rpcStatus?.isCritical ? 'bg-red-500' : 'bg-yellow-500'
                  }`}>
                    {totalAlertBadge}
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

                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-green-400" />
                    <Label className="text-sm text-white">Training Mode</Label>
                  </div>
                  <Switch
                    checked={trainingMode}
                    onCheckedChange={handleToggleTrainingMode}
                    disabled={isLoading}
                    data-testid="admin-training-mode-toggle"
                  />
                </div>
                <p className="text-xs text-gray-500 -mt-2 ml-1">
                  Removes bots, spawns 3 static dummies (one per shape). Only you can join.
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
                    disabled={isLoading}
                  />
                  <Input
                    placeholder="Reason (optional)"
                    value={banReasonInput}
                    onChange={(e) => setBanReasonInput(e.target.value)}
                    className="bg-gray-800 border-gray-700 text-xs"
                    disabled={isLoading}
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

                {rpcStatus && rpcHasIssues && (
                  <div className={`p-3 rounded-lg border ${
                    rpcStatus.isCritical
                      ? 'bg-red-500/10 border-red-500/40'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className={`w-4 h-4 ${rpcStatus.isCritical ? 'text-red-400' : 'text-yellow-400'}`} />
                      <span className={`text-sm font-bold ${rpcStatus.isCritical ? 'text-red-300' : 'text-yellow-300'}`}>
                        {rpcStatus.isCritical ? 'RPC Under Heavy Pressure' : 'RPC Slowdowns Detected'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-300 mb-1">
                      {rpcStatus.totalErrors} error{rpcStatus.totalErrors !== 1 ? 's' : ''} in the last {rpcStatus.windowMinutes} minutes
                      {rpcStatus.fallbackActivations > 0 && ` · fell back to public endpoint ${rpcStatus.fallbackActivations} time${rpcStatus.fallbackActivations !== 1 ? 's' : ''}`}
                    </p>
                    {rpcStatus.lastErrorAt && (
                      <p className="text-xs text-gray-500">
                        Last error: {new Date(rpcStatus.lastErrorAt).toLocaleTimeString()}
                      </p>
                    )}
                    <p className={`text-xs mt-1 ${rpcStatus.isCritical ? 'text-red-400' : 'text-yellow-500'}`}>
                      {rpcStatus.isCritical
                        ? 'Deposits and withdrawals are being delayed — consider adding a paid RPC URL.'
                        : 'Operations are slowing down but still completing via retries.'}
                    </p>
                  </div>
                )}

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
