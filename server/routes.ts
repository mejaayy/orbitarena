import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initGameServer, getGameServer } from "./gameServer";
import { balanceService } from "./balanceService";
import { getSolanaNetwork, getUSDCMint, getPlatformWalletAddress, getRpcErrorStatus } from "./solana";
import { z } from "zod";
import { db } from "./db";
import { weeklyEarnings, bannedWallets, adminSettings, winStreaks } from "@shared/schema";
import { desc, sql, gte, eq } from "drizzle-orm";
import { 
  hasAdminPassword, 
  setAdminPassword, 
  verifyAdminPassword, 
  createAdminSession, 
  validateAdminSession,
  invalidateAdminSession,
  validatePasswordStrength,
  MIN_PASSWORD_LENGTH
} from "./adminAuth";

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return false;
  
  if (Date.now() - attempt.lastAttempt > LOCKOUT_DURATION_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  
  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordLoginAttempt(ip: string, success: boolean): void {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  
  const attempt = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  attempt.count++;
  attempt.lastAttempt = Date.now();
  loginAttempts.set(ip, attempt);
}

async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers['x-admin-token'] as string;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const isValid = await validateAdminSession(token);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  next();
}

const depositRequestSchema = z.object({
  walletAddress: z.string().min(32),
  amountCents: z.number().positive().int(),
});

const depositConfirmSchema = z.object({
  depositToken: z.string().min(10),
  onChainTxSignature: z.string().min(10),
});

const withdrawalSchema = z.object({
  walletAddress: z.string().min(32),
  amountCents: z.number().positive().int(),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  initGameServer(httpServer);

  app.get("/api/config", async (req, res) => {
    try {
      const network = getSolanaNetwork();
      const mint = getUSDCMint().toBase58();
      const platformWalletAddress = getPlatformWalletAddress();
      res.json({ solanaNetwork: network, usdcMint: mint, platformWalletAddress });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/health", (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });

  app.get("/api/game/status", (req, res) => {
    res.set('Cache-Control', 'no-store');
    const gameServer = getGameServer();
    res.json({
      playerCount: gameServer?.getTotalPlayerCount() || 0,
      maxPlayers: gameServer?.getMaxTotalPlayers() || 150,
      roomCount: gameServer?.getRoomCount() || 0,
      rooms: gameServer?.getRoomStats() || [],
      status: "running"
    });
  });

  app.get("/api/balance/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress || walletAddress.length < 32) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const balance = await balanceService.getBalance(walletAddress);
      res.json({
        walletAddress,
        availableCents: balance.available,
        lockedCents: balance.locked,
        availableUsd: (balance.available / 100).toFixed(2),
        lockedUsd: (balance.locked / 100).toFixed(2),
        lifetime: {
          deposited: (balance.lifetime.deposited / 100).toFixed(2),
          withdrawn: (balance.lifetime.withdrawn / 100).toFixed(2),
          prizes: (balance.lifetime.prizes / 100).toFixed(2),
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/balance/:walletAddress/transactions", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (!walletAddress || walletAddress.length < 32) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const transactions = await balanceService.getTransactionHistory(walletAddress, limit);
      res.json({
        walletAddress,
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.transactionType,
          deltaAvailable: t.deltaAvailableCents,
          deltaLocked: t.deltaLockedCents,
          createdAt: t.createdAt,
          metadata: t.metadata,
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress || walletAddress.length < 32) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }
      const stats = await balanceService.getStats(walletAddress);
      const transactions = await balanceService.getTransactionHistory(walletAddress, 50);
      res.json({
        walletAddress,
        stats,
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.transactionType,
          deltaAvailable: t.deltaAvailableCents,
          deltaLocked: t.deltaLockedCents,
          createdAt: t.createdAt,
          metadata: t.metadata,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/balance/deposit/request", async (req, res) => {
    try {
      const result = depositRequestSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid request", details: result.error.issues });
      }

      const { walletAddress, amountCents } = result.data;
      const { depositToken } = await balanceService.createDepositRequest(walletAddress, amountCents);

      res.json({
        success: true,
        depositToken,
        amountCents,
        message: `Deposit request created. Use depositToken to confirm after on-chain transfer.`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/balance/deposit/confirm", async (req, res) => {
    try {
      const result = depositConfirmSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid request", details: result.error.issues });
      }

      const { depositToken, onChainTxSignature } = result.data;
      const depositResult = await balanceService.confirmDeposit(depositToken, onChainTxSignature);

      if (!depositResult.success) {
        return res.status(400).json({ error: depositResult.error });
      }

      const pending = (balanceService as any).pendingDeposits?.get(depositToken);
      const walletAddress = pending?.walletAddress || result.data.depositToken.split('_')[1];
      const balance = walletAddress ? await balanceService.getBalance(walletAddress).catch(() => null) : null;

      res.json({
        success: true,
        message: "Deposit confirmed and credited to your balance",
        transactionId: depositResult.transactionId,
        ...(balance ? {
          balance: {
            availableCents: balance.available,
            availableUsd: (balance.available / 100).toFixed(2),
          }
        } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/balance/withdraw", async (req, res) => {
    try {
      const result = withdrawalSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid request", details: result.error.issues });
      }

      const { walletAddress, amountCents } = result.data;

      const withdrawResult = await balanceService.requestWithdrawal(walletAddress, amountCents);
      if (!withdrawResult.success) {
        return res.status(400).json({ error: withdrawResult.error });
      }

      const balance = await balanceService.getBalance(walletAddress);
      res.json({
        success: true,
        message: `Withdrawal of $${(amountCents / 100).toFixed(2)} initiated`,
        transactionId: withdrawResult.transactionId,
        balance: {
          availableCents: balance.available,
          availableUsd: (balance.available / 100).toFixed(2),
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get weekly top players leaderboard
  app.get("/api/leaderboard/weekly", async (req, res) => {
    try {
      // Get start of current week (Sunday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);

      const topPlayers = await db
        .select({
          walletAddress: weeklyEarnings.walletAddress,
          playerName: weeklyEarnings.playerName,
          earnedCents: weeklyEarnings.earnedCents,
        })
        .from(weeklyEarnings)
        .where(gte(weeklyEarnings.weekStart, weekStart))
        .orderBy(desc(weeklyEarnings.earnedCents))
        .limit(10);

      res.json({
        weekStart: weekStart.toISOString(),
        players: topPlayers.map(p => ({
          wallet: p.walletAddress,
          name: p.playerName,
          earnedUsd: (p.earnedCents / 100).toFixed(2),
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Check if password is set
  app.get("/api/admin/auth/status", async (req, res) => {
    try {
      const hasPassword = await hasAdminPassword();
      res.json({ hasPassword });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Set password (first time setup)
  app.post("/api/admin/auth/setup", async (req, res) => {
    try {
      const existing = await hasAdminPassword();
      if (existing) {
        return res.status(400).json({ error: 'Password already set. Use change-password instead.' });
      }
      
      const { password } = req.body;
      const validation = validatePasswordStrength(password);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      
      const result = await setAdminPassword(password);
      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Failed to set password' });
      }
      
      const token = await createAdminSession();
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Login
  app.post("/api/admin/auth/login", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      
      if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
      }
      
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }
      
      const isValid = await verifyAdminPassword(password);
      recordLoginAttempt(ip, isValid);
      
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid password' });
      }
      
      const token = await createAdminSession();
      res.json({ success: true, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Logout
  app.post("/api/admin/auth/logout", async (req, res) => {
    try {
      const token = req.headers['x-admin-token'] as string;
      if (token) {
        await invalidateAdminSession(token);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Change password (requires auth)
  app.post("/api/admin/auth/change-password", requireAdminAuth, async (req, res) => {
    try {
      const { password } = req.body;
      const validation = validatePasswordStrength(password);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      
      const result = await setAdminPassword(password);
      if (!result.success) {
        return res.status(500).json({ error: result.error || 'Failed to change password' });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get banned wallets (protected)
  app.get("/api/admin/banned", requireAdminAuth, async (req, res) => {
    try {
      const banned = await db.select().from(bannedWallets).orderBy(desc(bannedWallets.bannedAt));
      res.json({ wallets: banned });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Ban a wallet (protected)
  app.post("/api/admin/ban", requireAdminAuth, async (req, res) => {
    try {
      const { walletAddress, reason } = req.body;
      if (!walletAddress || walletAddress.length < 32) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      await db.insert(bannedWallets)
        .values({ walletAddress, reason: reason || "Banned by admin" })
        .onConflictDoNothing();

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Unban a wallet (protected)
  app.post("/api/admin/unban", requireAdminAuth, async (req, res) => {
    try {
      const { walletAddress } = req.body;
      await db.delete(bannedWallets).where(eq(bannedWallets.walletAddress, walletAddress));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Check if wallet is banned (protected)
  app.get("/api/admin/banned/:walletAddress", requireAdminAuth, async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const banned = await db.query.bannedWallets.findFirst({
        where: eq(bannedWallets.walletAddress, walletAddress),
      });
      res.json({ banned: !!banned });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get leaderboard settings (protected)
  app.get("/api/admin/settings", requireAdminAuth, async (req, res) => {
    try {
      const settings = await db.select().from(adminSettings);
      const settingsMap: Record<string, any> = {};
      for (const s of settings) {
        settingsMap[s.key] = s.value;
      }
      res.json(settingsMap);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Update setting (protected)
  app.post("/api/admin/settings", requireAdminAuth, async (req, res) => {
    try {
      const { key, value } = req.body;
      await db.insert(adminSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: adminSettings.key,
          set: { value, updatedAt: new Date() },
        });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Reset leaderboard (protected)
  app.post("/api/admin/leaderboard/reset", requireAdminAuth, async (req, res) => {
    try {
      await db.delete(weeklyEarnings);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get win streak alerts (protected)
  app.get("/api/admin/alerts", requireAdminAuth, async (req, res) => {
    try {
      const alerts = await db
        .select()
        .from(winStreaks)
        .where(gte(winStreaks.currentStreak, 5))
        .orderBy(desc(winStreaks.currentStreak));
      
      res.json({
        alerts: alerts.map(a => ({
          walletAddress: a.walletAddress,
          playerName: a.playerName,
          streak: a.currentStreak,
          alertCount: a.alertCount,
          lastWinAt: a.lastWinAt,
          isCritical: a.alertCount >= 2,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: RPC health status (protected)
  app.get("/api/admin/rpc-status", requireAdminAuth, (req, res) => {
    res.json(getRpcErrorStatus());
  });

  // Admin: Clear alerts (protected)
  app.post("/api/admin/alerts/clear", requireAdminAuth, async (req, res) => {
    try {
      await db.update(winStreaks).set({ currentStreak: 0 });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/training", requireAdminAuth, async (req, res) => {
    const gs = getGameServer();
    res.json({ enabled: gs?.isTrainingMode() ?? false });
  });

  app.post("/api/admin/training", requireAdminAuth, async (req, res) => {
    const gs = getGameServer();
    if (!gs) {
      return res.status(500).json({ error: 'Game server not available' });
    }
    const { enabled } = req.body;
    if (enabled) {
      gs.enableTrainingMode();
    } else {
      gs.disableTrainingMode();
    }
    res.json({ success: true, enabled: gs.isTrainingMode() });
  });

  return httpServer;
}
