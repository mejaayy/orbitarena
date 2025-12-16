import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initGameServer, getGameServer } from "./gameServer";
import { balanceService } from "./balanceService";
import { z } from "zod";

const depositSchema = z.object({
  walletAddress: z.string().min(32),
  amountCents: z.number().positive().int(),
  externalRef: z.string().optional(),
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

  app.get("/api/game/status", (req, res) => {
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

  app.post("/api/balance/deposit", async (req, res) => {
    try {
      const result = depositSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: "Invalid request", details: result.error.issues });
      }

      const { walletAddress, amountCents, externalRef } = result.data;

      const depositResult = await balanceService.deposit(walletAddress, amountCents, externalRef);
      if (!depositResult.success) {
        return res.status(400).json({ error: depositResult.error });
      }

      const balance = await balanceService.getBalance(walletAddress);
      res.json({
        success: true,
        message: `Deposited $${(amountCents / 100).toFixed(2)} to your balance`,
        balance: {
          availableCents: balance.available,
          availableUsd: (balance.available / 100).toFixed(2),
        }
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

  return httpServer;
}
