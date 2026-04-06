import { db } from "./db";
import { playerBalances, balanceTransactions, weeklyEarnings, winStreaks, type TransactionType } from "@shared/schema";
import { eq, sql, and, gte } from "drizzle-orm";

const ENTRY_FEE_CENTS = 100;
const PLATFORM_FEE_CENTS = 10;
const PRIZE_CONTRIBUTION_CENTS = 90;

const PRIZE_1ST_CENTS = 400;
const PRIZE_2ND_CENTS = 300;
const PRIZE_3RD_CENTS = 200;

function maskWallet(wallet: string): string {
  if (!wallet || wallet.length < 12) return '****';
  return wallet.slice(0, 4) + '****' + wallet.slice(-4);
}

function log(message: string, type: string = 'balance') {
  const timestamp = new Date().toLocaleTimeString();
  const maskedMessage = message.replace(/([A-Za-z0-9]{32,})/g, (match) => maskWallet(match));
  console.log(`${timestamp} [${type}] ${maskedMessage}`);
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

  private pendingDeposits = new Map<string, { walletAddress: string; amountCents: number; createdAt: Date }>();

  async createDepositRequest(walletAddress: string, amountCents: number): Promise<{ depositToken: string }> {
    const depositToken = `deposit_${walletAddress.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.pendingDeposits.set(depositToken, {
      walletAddress,
      amountCents,
      createdAt: new Date(),
    });

    setTimeout(() => {
      this.pendingDeposits.delete(depositToken);
    }, 10 * 60 * 1000);

    log(`Created deposit request: ${depositToken} for ${amountCents} cents to ${walletAddress.slice(0, 8)}...`);
    return { depositToken };
  }

  async confirmDeposit(depositToken: string, onChainTxSignature: string): Promise<TransactionResult> {
    try {
      const pendingDeposit = this.pendingDeposits.get(depositToken);
      if (!pendingDeposit) {
        return { success: false, error: 'Invalid or expired deposit token' };
      }

      const { walletAddress, amountCents } = pendingDeposit;

      // Idempotency: use the on-chain tx signature as the unique reference
      const externalRef = `deposit_tx_${onChainTxSignature}`;

      const existingDeposit = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, externalRef),
      });
      if (existingDeposit) {
        this.pendingDeposits.delete(depositToken);
        log(`Deposit already processed for tx ${onChainTxSignature.slice(0, 16)}...`);
        return { success: true, transactionId: existingDeposit.id };
      }

      // Verify the on-chain transaction before crediting anything
      const { verifyUSDCDeposit } = await import('./solana');
      const verification = await verifyUSDCDeposit(onChainTxSignature, walletAddress, amountCents);
      if (!verification.valid) {
        log(`Deposit verification failed for ${walletAddress.slice(0, 8)}...: ${verification.error}`, 'error');
        return { success: false, error: verification.error };
      }

      await this.getOrCreateBalance(walletAddress);

      const [transaction] = await db.transaction(async (tx) => {
        await tx.update(playerBalances)
          .set({
            availableCents: sql`${playerBalances.availableCents} + ${amountCents}`,
            lifetimeDepositedCents: sql`${playerBalances.lifetimeDepositedCents} + ${amountCents}`,
            updatedAt: new Date(),
          })
          .where(eq(playerBalances.walletAddress, walletAddress));

        return tx.insert(balanceTransactions).values({
          walletAddress,
          transactionType: 'DEPOSIT' as TransactionType,
          deltaAvailableCents: amountCents,
          deltaLockedCents: 0,
          externalRef,
          metadata: { source: 'on_chain_verified', onChainTxSignature, depositToken },
        }).returning();
      });

      this.pendingDeposits.delete(depositToken);
      log(`Deposit verified and credited: $${(amountCents / 100).toFixed(2)} to ${walletAddress.slice(0, 8)}...`);
      return { success: true, transactionId: transaction.id };
    } catch (error: any) {
      if (error.code === '23505' && error.constraint?.includes('external_ref')) {
        this.pendingDeposits.delete(depositToken);
        log(`Deposit idempotency caught via unique constraint`);
        return { success: true };
      }
      log(`Deposit failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async lockForMatch(walletAddress: string, matchId: string): Promise<TransactionResult> {
    try {
      const balance = await this.getOrCreateBalance(walletAddress);

      const lockRef = `match_lock_${matchId}_${walletAddress}`;
      const unlockRef = `match_unlock_${matchId}_${walletAddress}`;

      const existingLock = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, lockRef),
      });

      if (existingLock) {
        const existingUnlock = await db.query.balanceTransactions.findFirst({
          where: eq(balanceTransactions.externalRef, unlockRef),
        });
        if (!existingUnlock) {
          return { success: true };
        }
      }

      if (balance.availableCents < ENTRY_FEE_CENTS) {
        return { success: false, error: 'Insufficient balance for entry fee' };
      }

      const uniqueLockRef = existingLock 
        ? `match_lock_${matchId}_${walletAddress}_${Date.now()}`
        : lockRef;

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
          externalRef: uniqueLockRef,
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
      const lockPrefix = `match_lock_${matchId}_${walletAddress}`;
      const existingLocks = await db.query.balanceTransactions.findMany({
        where: sql`${balanceTransactions.externalRef} LIKE ${lockPrefix + '%'} AND ${balanceTransactions.transactionType} = 'MATCH_LOCK'`,
        orderBy: sql`${balanceTransactions.createdAt} DESC`,
      });

      if (existingLocks.length === 0) {
        return { success: false, error: 'No lock found for this match' };
      }

      const unlockPrefix = `match_unlock_${matchId}_${walletAddress}`;
      const existingUnlocks = await db.query.balanceTransactions.findMany({
        where: sql`${balanceTransactions.externalRef} LIKE ${unlockPrefix + '%'} AND ${balanceTransactions.transactionType} = 'MATCH_UNLOCK'`,
      });

      if (existingUnlocks.length >= existingLocks.length) {
        return { success: true };
      }

      const unlockRef = existingUnlocks.length > 0
        ? `match_unlock_${matchId}_${walletAddress}_${Date.now()}`
        : `match_unlock_${matchId}_${walletAddress}`;

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
          externalRef: unlockRef,
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

  async releaseAllOrphanedLocks(): Promise<void> {
    try {
      const allLocks = await db.query.balanceTransactions.findMany({
        where: sql`${balanceTransactions.transactionType} = 'MATCH_LOCK'`,
      });

      for (const lock of allLocks) {
        if (!lock.externalRef) continue;
        const unlockRef = lock.externalRef.replace('match_lock_', 'match_unlock_');
        const settleRef = lock.externalRef.replace('match_lock_', 'match_settle_');
        const matchId = (lock.metadata as any)?.matchId;

        const existingUnlock = await db.query.balanceTransactions.findFirst({
          where: eq(balanceTransactions.externalRef, unlockRef),
        });

        if (existingUnlock) continue;

        const existingSettle = await db.query.balanceTransactions.findFirst({
          where: sql`${balanceTransactions.externalRef} LIKE ${'match_settle_' + (matchId || '') + '%'}`,
        });

        if (existingSettle) continue;

        await this.releaseLock(lock.walletAddress, matchId || '');
        log(`Released orphaned lock for wallet ${lock.walletAddress.slice(0, 8)}... match ${matchId}`, 'room');
      }
    } catch (error: any) {
      log(`Orphaned lock cleanup failed: ${error.message}`, 'error');
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

      let platformRevenueCents = 0;

      await db.transaction(async (tx) => {
        await tx.insert(balanceTransactions).values({
          walletAddress: 'SYSTEM',
          transactionType: 'PRIZE_PAYOUT' as TransactionType,
          deltaAvailableCents: 0,
          deltaLockedCents: 0,
          externalRef: `match_settle_${matchId}`,
          metadata: { matchId, playerCount: standings.length, settled: true },
        });

        for (const standing of standings) {
          const lockRef = `match_lock_${matchId}_${standing.walletAddress}`;
          const existingLock = await tx.query.balanceTransactions.findFirst({
            where: eq(balanceTransactions.externalRef, lockRef),
          });

          if (!existingLock) {
            log(`No lock found for ${standing.walletAddress.slice(0, 8)}... in match ${matchId} - skipping`);
            continue;
          }

          const prizeRef = `match_prize_${matchId}_${standing.walletAddress}`;
          const existingPrize = await tx.query.balanceTransactions.findFirst({
            where: eq(balanceTransactions.externalRef, prizeRef),
          });

          if (existingPrize) {
            continue;
          }

          let prizeCents = 0;
          if (standing.rank === 1) prizeCents = PRIZE_1ST_CENTS;
          else if (standing.rank === 2) prizeCents = PRIZE_2ND_CENTS;
          else if (standing.rank === 3) prizeCents = PRIZE_3RD_CENTS;

          const currentBalance = await tx.query.playerBalances.findFirst({
            where: eq(playerBalances.walletAddress, standing.walletAddress),
          });

          if (!currentBalance || currentBalance.lockedCents < ENTRY_FEE_CENTS) {
            log(`Insufficient locked balance for ${standing.walletAddress.slice(0, 8)}... - skipping`);
            continue;
          }

          await tx.update(playerBalances)
            .set({
              lockedCents: sql`${playerBalances.lockedCents} - ${ENTRY_FEE_CENTS}`,
              availableCents: sql`${playerBalances.availableCents} + ${prizeCents}`,
              lifetimePrizeCents: sql`${playerBalances.lifetimePrizeCents} + ${prizeCents}`,
              updatedAt: new Date(),
            })
            .where(eq(playerBalances.walletAddress, standing.walletAddress));

          platformRevenueCents += ENTRY_FEE_CENTS - prizeCents;

          await tx.insert(balanceTransactions).values({
            walletAddress: standing.walletAddress,
            transactionType: prizeCents > 0 ? 'PRIZE_PAYOUT' as TransactionType : 'MATCH_UNLOCK' as TransactionType,
            deltaAvailableCents: prizeCents,
            deltaLockedCents: -ENTRY_FEE_CENTS,
            externalRef: prizeRef,
            metadata: { matchId, rank: standing.rank, prize: prizeCents, name: standing.name },
          });

          if (prizeCents > 0) {
            log(`Prize payout: ${prizeCents} cents to ${standing.walletAddress.slice(0, 8)}... (rank ${standing.rank})`);
            
            // Record weekly earnings
            await this.recordWeeklyEarning(standing.walletAddress, standing.name, prizeCents, tx);
            
            // Track win streaks for 1st place wins
            if (standing.rank === 1) {
              await this.recordWinStreak(standing.walletAddress, standing.name, tx);
            }
          } else {
            log(`Entry fee consumed for ${standing.walletAddress.slice(0, 8)}... (rank ${standing.rank})`);
            // Reset win streak for non-winners
            await this.resetWinStreak(standing.walletAddress, tx);
          }
        }

        if (platformRevenueCents > 0) {
          await tx.insert(balanceTransactions).values({
            walletAddress: 'PLATFORM',
            transactionType: 'PRIZE_PAYOUT' as TransactionType,
            deltaAvailableCents: platformRevenueCents,
            deltaLockedCents: 0,
            externalRef: `match_platform_${matchId}`,
            metadata: { matchId, revenue: platformRevenueCents },
          });
        }
      });

      log(`Match ${matchId} settled - ${standings.length} players, platform revenue: ${platformRevenueCents} cents`);
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

      // Execute the on-chain USDC transfer first — only debit DB after it succeeds
      const { executeUSDCWithdrawal } = await import('./solana');
      const onChain = await executeUSDCWithdrawal(walletAddress, amountCents);
      if (!onChain.success) {
        log(`On-chain withdrawal failed for ${walletAddress.slice(0, 8)}...: ${onChain.error}`, 'error');
        return { success: false, error: onChain.error };
      }

      const externalRef = `withdrawal_tx_${onChain.txSignature}`;

      // Idempotency guard
      const existing = await db.query.balanceTransactions.findFirst({
        where: eq(balanceTransactions.externalRef, externalRef),
      });
      if (existing) {
        return { success: true, transactionId: existing.id };
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
          externalRef,
          metadata: { amount: amountCents, status: 'completed', txSignature: onChain.txSignature },
        }).returning();
      });

      log(`Withdrawal completed: $${(amountCents / 100).toFixed(2)} from ${walletAddress.slice(0, 8)}... | tx: ${onChain.txSignature?.slice(0, 16)}...`);
      return { success: true, transactionId: transaction.id };
    } catch (error: any) {
      if (error.code === '23505' && error.constraint?.includes('external_ref')) {
        return { success: true };
      }
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

  async recordWeeklyEarning(walletAddress: string, playerName: string, earnedCents: number, txn?: any) {
    const dbInstance = txn || db;
    
    // Get start of current week (Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);

    // Check if record exists for this wallet this week
    const existing = await dbInstance.query.weeklyEarnings.findFirst({
      where: and(
        eq(weeklyEarnings.walletAddress, walletAddress),
        gte(weeklyEarnings.weekStart, weekStart)
      ),
    });

    if (existing) {
      // Update existing record
      await dbInstance
        .update(weeklyEarnings)
        .set({
          earnedCents: sql`${weeklyEarnings.earnedCents} + ${earnedCents}`,
          playerName: playerName,
          updatedAt: new Date(),
        })
        .where(eq(weeklyEarnings.id, existing.id));
    } else {
      // Insert new record
      await dbInstance.insert(weeklyEarnings).values({
        walletAddress,
        playerName,
        weekStart,
        earnedCents,
      });
    }
  }

  async recordWinStreak(walletAddress: string, playerName: string, txn?: any) {
    const dbInstance = txn || db;
    
    const existing = await dbInstance.query.winStreaks.findFirst({
      where: eq(winStreaks.walletAddress, walletAddress),
    });

    if (existing) {
      const newStreak = existing.currentStreak + 1;
      const newAlertCount = newStreak >= 5 ? existing.alertCount + 1 : existing.alertCount;
      
      await dbInstance
        .update(winStreaks)
        .set({
          currentStreak: newStreak,
          alertCount: newAlertCount,
          playerName: playerName,
          lastWinAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(winStreaks.id, existing.id));
      
      if (newStreak >= 5) {
        log(`ALERT: ${playerName} (${walletAddress.slice(0, 8)}...) has ${newStreak} wins in a row! Alert count: ${newAlertCount}`, 'alert');
      }
    } else {
      await dbInstance.insert(winStreaks).values({
        walletAddress,
        playerName,
        currentStreak: 1,
        alertCount: 0,
        lastWinAt: new Date(),
      });
    }
  }

  async resetWinStreak(walletAddress: string, txn?: any) {
    const dbInstance = txn || db;
    
    await dbInstance
      .update(winStreaks)
      .set({
        currentStreak: 0,
        updatedAt: new Date(),
      })
      .where(eq(winStreaks.walletAddress, walletAddress));
  }
}

export const balanceService = new BalanceService();
