import { log } from './index';

const ENTRY_FEE_USDC = 1;
const EXIT_FEE_PERCENT = 10;

interface PlayerEscrow {
  walletAddress: string;
  balance: number;
  depositTime: number;
  totalDeposited: number;
  totalEarned: number;
  totalLost: number;
}

interface FeeTransaction {
  timestamp: number;
  playerWallet: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
}

class EscrowService {
  private escrows: Map<string, PlayerEscrow> = new Map();
  private platformBalance: number = 0;
  private feeTransactions: FeeTransaction[] = [];
  private totalFeesCollected: number = 0;

  getPlatformWallet(): string | null {
    return process.env.PLATFORM_WALLET_ADDRESS || null;
  }

  deposit(walletAddress: string): { success: boolean; balance: number; error?: string } {
    if (this.escrows.has(walletAddress)) {
      const existing = this.escrows.get(walletAddress)!;
      return { success: true, balance: existing.balance };
    }

    const escrow: PlayerEscrow = {
      walletAddress,
      balance: ENTRY_FEE_USDC,
      depositTime: Date.now(),
      totalDeposited: ENTRY_FEE_USDC,
      totalEarned: 0,
      totalLost: 0
    };

    this.escrows.set(walletAddress, escrow);
    log(`Escrow deposit: ${walletAddress} deposited ${ENTRY_FEE_USDC} USDC`, 'solana');
    
    return { success: true, balance: escrow.balance };
  }

  transferOnKill(killerWallet: string, victimWallet: string): { 
    success: boolean; 
    amount: number; 
    killerBalance: number;
    victimBalance: number;
    error?: string 
  } {
    const killerEscrow = this.escrows.get(killerWallet);
    const victimEscrow = this.escrows.get(victimWallet);

    if (!killerEscrow) {
      return { success: false, amount: 0, killerBalance: 0, victimBalance: 0, error: 'Killer not in escrow' };
    }

    if (!victimEscrow) {
      return { success: false, amount: 0, killerBalance: killerEscrow.balance, victimBalance: 0, error: 'Victim not in escrow' };
    }

    const transferAmount = Math.min(1, victimEscrow.balance);
    if (transferAmount <= 0) {
      return { 
        success: true, 
        amount: 0, 
        killerBalance: killerEscrow.balance, 
        victimBalance: victimEscrow.balance,
        error: 'Victim has no balance' 
      };
    }

    victimEscrow.balance -= transferAmount;
    victimEscrow.totalLost += transferAmount;
    killerEscrow.balance += transferAmount;
    killerEscrow.totalEarned += transferAmount;

    log(`Escrow transfer: ${transferAmount} USDC from ${victimWallet.slice(0,8)}... to ${killerWallet.slice(0,8)}...`, 'solana');

    return {
      success: true,
      amount: transferAmount,
      killerBalance: killerEscrow.balance,
      victimBalance: victimEscrow.balance
    };
  }

  withdraw(walletAddress: string): { 
    success: boolean; 
    grossAmount: number;
    fee: number;
    netAmount: number;
    platformWalletConfigured: boolean;
    error?: string 
  } {
    const escrow = this.escrows.get(walletAddress);
    
    if (!escrow) {
      return { success: false, grossAmount: 0, fee: 0, netAmount: 0, platformWalletConfigured: false, error: 'Not in escrow' };
    }

    const grossAmount = escrow.balance;
    const fee = grossAmount * (EXIT_FEE_PERCENT / 100);
    const netAmount = grossAmount - fee;
    const platformWallet = this.getPlatformWallet();

    this.platformBalance += fee;
    this.totalFeesCollected += fee;
    this.escrows.delete(walletAddress);

    const feeTransaction: FeeTransaction = {
      timestamp: Date.now(),
      playerWallet: walletAddress,
      grossAmount,
      feeAmount: fee,
      netAmount
    };
    this.feeTransactions.push(feeTransaction);

    log(`Escrow withdraw: ${walletAddress.slice(0,8)}... withdrew ${netAmount.toFixed(4)} USDC`, 'solana');
    log(`Platform fee: ${fee.toFixed(4)} USDC collected (total: ${this.totalFeesCollected.toFixed(4)} USDC)`, 'solana');
    
    if (platformWallet) {
      log(`Fee destination: ${platformWallet.slice(0,8)}...${platformWallet.slice(-4)}`, 'solana');
    } else {
      log(`Warning: PLATFORM_WALLET_ADDRESS not set - fees held in escrow`, 'solana');
    }

    return {
      success: true,
      grossAmount,
      fee,
      netAmount,
      platformWalletConfigured: !!platformWallet
    };
  }

  getBalance(walletAddress: string): number {
    return this.escrows.get(walletAddress)?.balance || 0;
  }

  getPlayerStats(walletAddress: string): PlayerEscrow | null {
    return this.escrows.get(walletAddress) || null;
  }

  getPlatformBalance(): number {
    return this.platformBalance;
  }

  getTotalEscrowedBalance(): number {
    let total = 0;
    this.escrows.forEach(e => total += e.balance);
    return total;
  }

  getActivePlayerCount(): number {
    return this.escrows.size;
  }

  getTotalFeesCollected(): number {
    return this.totalFeesCollected;
  }

  getFeeTransactionCount(): number {
    return this.feeTransactions.length;
  }

  getRecentFeeTransactions(limit: number = 10): FeeTransaction[] {
    return this.feeTransactions.slice(-limit);
  }

  getFeeStats(): {
    totalFeesCollected: number;
    transactionCount: number;
    platformWallet: string | null;
    platformWalletConfigured: boolean;
  } {
    const platformWallet = this.getPlatformWallet();
    return {
      totalFeesCollected: this.totalFeesCollected,
      transactionCount: this.feeTransactions.length,
      platformWallet: platformWallet ? `${platformWallet.slice(0,8)}...${platformWallet.slice(-4)}` : null,
      platformWalletConfigured: !!platformWallet
    };
  }
}

export const escrowService = new EscrowService();
