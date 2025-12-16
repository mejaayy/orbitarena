import { db } from "./db";
import { playerBalances, balanceTransactions, type TransactionType } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const ENTRY_FEE_CENTS = 100;
const PLATFORM_FEE_CENTS = 10;
const PRIZE_CONTRIBUTION_CENTS = 90;

const PRIZE_1ST_CENTS = 600;
const PRIZE_2ND_CENTS = 450;
const PRIZE_3RD_CENTS = 300;

function log(message: string, type: string = 'balance') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} [${type}] ${message}`);
}

export interface BalanceResult {
  success: boolean;
  error?: string;
  balance?: {
    available: number;
    locked: number;
  };
}

export interface TransactionResult {
  success: boolean;
  error?: string;
  transactionId?: string;
}

class BalanceService {
  async getOrCreateBalance(walletAddress: string) {
    const existing = await db.query.playerBalances.findFirst({
      where: eq(playerBalances.walletAddress, walletAddress),
    });

    if (existing) {
      return existing;
    }

    const [newBalance] = await db.insert(playerBalances)
      .values({ walletAddress })
      .returning();

    log(`Created new balance record for ${walletAddress.slice(0, 8)}...`);
    return newBalance;
  }

  async getBalance(walletAddress: string): Promise<{ available: number; locked: number; lifetime: { deposited: number; withdrawn: number; prizes: number } }> {
    const balance = await this.getOrCreateBalance(walletAddress);
    return {
      available: balance.availableCents,
      locked: balance.lockedCents,
      lifetime: {
        deposited: balance.lifetimeDepositedCents,
        withdrawn: balance.lifetimeWithdrawnCents,
        prizes: balance.lifetimePrizeCents,
      }
    };
  }

  async deposit(walletAddress: string, amountCents: number, externalRef?: string): Promise<TransactionResult> {
    try {
      const balance = await this.getOrCreateBalance(walletAddress);

      await db.transaction(async (tx) => {
        await tx.update(playerBalances)
          .set({
            availableCents: sql`${playerBalances.availableCents} + ${amountCents}`,
            lifetimeDepositedCents: sql`${playerBalances.lifetimeDepositedCents} + ${amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(playerBalances.walletAddress, walletAddress));

        await tx.insert(balanceTransactions).values({
          walletAddress,
          transactionType: 'DEPOSIT' as TransactionType,
          deltaAvailableCents: amountCents,
          deltaLockedCents: 0,
          externalRef,
          metadata: { source: 'on_chain_deposit' },
        });
      });

      log(`Deposit: ${amountCents} cents to ${walletAddress.slice(0, 8)}...`);
      return { success: true };
    } catch (error: any) {
      log(`Deposit failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async lockForMatch(walletAddress: string, matchId: string): Promise<TransactionResult> {
    try {
      const balance = await this.getOrCreateBalance(walletAddress);

      if (balance.availableCents < ENTRY_FEE_CENTS) {
        return { success: false, error: 'Insufficient balance for entry fee' };
      }

      const existingLock = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, `match_lock_${matchId}_${walletAddress}`),
      });

      if (existingLock) {
        return { success: false, error: 'Already locked for this match' };
      }

      await db.transaction(async (tx) => {
        await tx.update(playerBalances)
          .set({
            availableCents: sql`${playerBalances.availableCents} - ${ENTRY_FEE_CENTS}`,
            lockedCents: sql`${playerBalances.lockedCents} + ${ENTRY_FEE_CENTS}`,
            updatedAt: new Date(),
          })
          .where(eq(playerBalances.walletAddress, walletAddress));

        await tx.insert(balanceTransactions).values({
          walletAddress,
          transactionType: 'MATCH_LOCK' as TransactionType,
          deltaAvailableCents: -ENTRY_FEE_CENTS,
          deltaLockedCents: ENTRY_FEE_CENTS,
          externalRef: `match_lock_${matchId}_${walletAddress}`,
          metadata: { matchId, entryFee: ENTRY_FEE_CENTS },
        });
      });

      log(`Match lock: ${ENTRY_FEE_CENTS} cents from ${walletAddress.slice(0, 8)}... for match ${matchId}`);
      return { success: true };
    } catch (error: any) {
      log(`Match lock failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async releaseLock(walletAddress: string, matchId: string): Promise<TransactionResult> {
    try {
      const existingLock = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, `match_lock_${matchId}_${walletAddress}`),
      });

      if (!existingLock) {
        return { success: false, error: 'No lock found for this match' };
      }

      const alreadyUnlocked = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, `match_unlock_${matchId}_${walletAddress}`),
      });

      if (alreadyUnlocked) {
        return { success: true };
      }

      await db.transaction(async (tx) => {
        await tx.update(playerBalances)
          .set({
            availableCents: sql`${playerBalances.availableCents} + ${ENTRY_FEE_CENTS}`,
            lockedCents: sql`${playerBalances.lockedCents} - ${ENTRY_FEE_CENTS}`,
            updatedAt: new Date(),
          })
          .where(eq(playerBalances.walletAddress, walletAddress));

        await tx.insert(balanceTransactions).values({
          walletAddress,
          transactionType: 'MATCH_UNLOCK' as TransactionType,
          deltaAvailableCents: ENTRY_FEE_CENTS,
          deltaLockedCents: -ENTRY_FEE_CENTS,
          externalRef: `match_unlock_${matchId}_${walletAddress}`,
          metadata: { matchId, reason: 'countdown_cancelled_or_refund' },
        });
      });

      log(`Match unlock: ${ENTRY_FEE_CENTS} cents to ${walletAddress.slice(0, 8)}... for match ${matchId}`);
      return { success: true };
    } catch (error: any) {
      log(`Match unlock failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async settlePayouts(
    matchId: string,
    standings: Array<{ walletAddress: string; rank: number; name: string; score: number }>
  ): Promise<TransactionResult> {
    try {
      const existingPayout = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, `match_settle_${matchId}`),
      });

      if (existingPayout) {
        log(`Match ${matchId} already settled - idempotency check passed`);
        return { success: true };
      }

      await db.transaction(async (tx) => {
        for (const standing of standings) {
          let prizeCents = 0;
          if (standing.rank === 1) prizeCents = PRIZE_1ST_CENTS;
          else if (standing.rank === 2) prizeCents = PRIZE_2ND_CENTS;
          else if (standing.rank === 3) prizeCents = PRIZE_3RD_CENTS;

          await tx.update(playerBalances)
            .set({
              lockedCents: sql`GREATEST(${playerBalances.lockedCents} - ${ENTRY_FEE_CENTS}, 0)`,
              availableCents: sql`${playerBalances.availableCents} + ${prizeCents}`,
              lifetimePrizeCents: sql`${playerBalances.lifetimePrizeCents} + ${prizeCents}`,
              updatedAt: new Date(),
            })
            .where(eq(playerBalances.walletAddress, standing.walletAddress));

          if (prizeCents > 0) {
            await tx.insert(balanceTransactions).values({
              walletAddress: standing.walletAddress,
              transactionType: 'PRIZE_PAYOUT' as TransactionType,
              deltaAvailableCents: prizeCents,
              deltaLockedCents: -ENTRY_FEE_CENTS,
              externalRef: `match_prize_${matchId}_${standing.walletAddress}`,
              metadata: { matchId, rank: standing.rank, prize: prizeCents, name: standing.name },
            });

            log(`Prize payout: ${prizeCents} cents to ${standing.walletAddress.slice(0, 8)}... (rank ${standing.rank})`);
          }
        }

        await tx.insert(balanceTransactions).values({
          walletAddress: 'SYSTEM',
          transactionType: 'PRIZE_PAYOUT' as TransactionType,
          deltaAvailableCents: 0,
          deltaLockedCents: 0,
          externalRef: `match_settle_${matchId}`,
          metadata: { matchId, playerCount: standings.length, settled: true },
        });
      });

      log(`Match ${matchId} settled - ${standings.length} players`);
      return { success: true };
    } catch (error: any) {
      log(`Settlement failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async requestWithdrawal(walletAddress: string, amountCents: number): Promise<TransactionResult> {
    try {
      const balance = await this.getOrCreateBalance(walletAddress);

      if (balance.availableCents < amountCents) {
        return { success: false, error: 'Insufficient available balance' };
      }

      if (balance.lockedCents > 0) {
        return { success: false, error: 'Cannot withdraw while balance is locked in a match' };
      }

      const [transaction] = await db.transaction(async (tx) => {
        await tx.update(playerBalances)
          .set({
            availableCents: sql`${playerBalances.availableCents} - ${amountCents}`,
            lifetimeWithdrawnCents: sql`${playerBalances.lifetimeWithdrawnCents} + ${amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(playerBalances.walletAddress, walletAddress));

        return tx.insert(balanceTransactions).values({
          walletAddress,
          transactionType: 'WITHDRAWAL' as TransactionType,
          deltaAvailableCents: -amountCents,
          deltaLockedCents: 0,
          metadata: { amount: amountCents, status: 'pending' },
        }).returning();
      });

      log(`Withdrawal requested: ${amountCents} cents from ${walletAddress.slice(0, 8)}...`);
      return { success: true, transactionId: transaction.id };
    } catch (error: any) {
      log(`Withdrawal failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async getTransactionHistory(walletAddress: string, limit: number = 20) {
    const transactions = await db.query.balanceTransactions.findMany({
      where: eq(balanceTransactions.walletAddress, walletAddress),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit,
    });

    return transactions;
  }

  getEntryFeeCents() {
    return ENTRY_FEE_CENTS;
  }

  getPrizeAmounts() {
    return {
      first: PRIZE_1ST_CENTS,
      second: PRIZE_2ND_CENTS,
      third: PRIZE_3RD_CENTS,
      contribution: PRIZE_CONTRIBUTION_CENTS,
    };
  }
}

export const balanceService = new BalanceService();
