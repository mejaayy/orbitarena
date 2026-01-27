import React, { useState, useEffect } from 'react';
import { Settings, X, Eye, EyeOff, Trash2, RefreshCw, Users, Trophy, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface AdminPanelProps {
  onMockLeaderboard: (enabled: boolean) => void;
  mockLeaderboardEnabled: boolean;
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

  useEffect(() => {
    const savedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    setHasPassword(!!savedPassword);
  }, []);

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
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full border border-white/10 transition-colors"
        data-testid="admin-panel-toggle"
      >
        <Settings className="w-5 h-5 text-gray-400" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl" data-testid="admin-panel">
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          <span className="font-bold text-white text-sm">Admin Panel</span>
        </div>
        <button onClick={handleClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4">
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

            <div className="border-t border-white/10 pt-4 space-y-2">
              <Button
                onClick={handleClearLocalStorage}
                variant="outline"
                className="w-full justify-start text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
                data-testid="admin-clear-storage"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Local Storage
              </Button>

              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="w-full justify-start"
                data-testid="admin-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Page
              </Button>

              <Button
                onClick={() => setShowChangePassword(true)}
                variant="outline"
                className="w-full justify-start"
                data-testid="admin-change-password"
              >
                <Lock className="w-4 h-4 mr-2" />
                Change Password
              </Button>
            </div>

            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-gray-500 text-center">
                Admin panel for testing and configuration
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
