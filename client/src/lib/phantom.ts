import { Connection, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';

interface PhantomProvider {
  isPhantom: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: any) => Promise<any>;
  signAllTransactions: (transactions: any[]) => Promise<any[]>;
  publicKey: PublicKey | null;
  isConnected: boolean;
  on: (event: string, callback: (args: any) => void) => void;
  off: (event: string, callback: (args: any) => void) => void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
    solana?: PhantomProvider;
  }
}

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  return null;
}

// Network and mint are driven by server config fetched at runtime.
// These defaults are used before /api/config resolves.
export const USDC_MINT_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_MINT_DEVNET  = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const ENTRY_FEE_USDC = 1;
export const EXIT_FEE_PERCENT = 10;

// Runtime config — populated by fetchSolanaConfig()
let _solanaNetwork: string = 'mainnet-beta';
let _usdcMint: PublicKey = USDC_MINT_MAINNET;
let _platformWallet: string = '';

export interface SolanaConfig {
  solanaNetwork: string;
  usdcMint: string;
  platformWalletAddress: string;
}

export async function fetchSolanaConfig(): Promise<SolanaConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to fetch server config');
  const cfg: SolanaConfig = await res.json();
  _solanaNetwork = cfg.solanaNetwork;
  _usdcMint = new PublicKey(cfg.usdcMint);
  _platformWallet = cfg.platformWalletAddress;
  return cfg;
}

export function getUSDCMint(): PublicKey { return _usdcMint; }
export function getPlatformWalletAddress(): string { return _platformWallet; }

export function getConnection(): Connection {
  if (_solanaNetwork === 'devnet') {
    return new Connection(clusterApiUrl('devnet'), 'confirmed');
  }
  return new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
}

export function isPhantomInstalled(): boolean {
  return getPhantomProvider() !== null;
}

export async function connectPhantom(): Promise<string | null> {
  const provider = getPhantomProvider();
  if (!provider) {
    window.open('https://phantom.app/', '_blank');
    return null;
  }
  try {
    const response = await provider.connect();
    return response.publicKey.toBase58();
  } catch (error) {
    console.error('Failed to connect Phantom:', error);
    return null;
  }
}

export async function disconnectPhantom(): Promise<void> {
  const provider = getPhantomProvider();
  if (provider) await provider.disconnect();
}

export function getConnectedWallet(): string | null {
  const provider = getPhantomProvider();
  if (provider?.isConnected && provider.publicKey) {
    return provider.publicKey.toBase58();
  }
  return null;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export async function getUSDCBalance(walletAddress: string): Promise<number> {
  try {
    const connection = getConnection();
    const wallet = new PublicKey(walletAddress);
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const tokenAccount = await getAssociatedTokenAddress(getUSDCMint(), wallet);
    try {
      const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
      return parseFloat(accountInfo.value.uiAmountString || '0');
    } catch {
      return 0;
    }
  } catch (error) {
    console.error('Failed to fetch USDC balance:', error);
    return 0;
  }
}

export interface DepositResult {
  success: boolean;
  txSignature?: string;
  error?: string;
}

/**
 * Uses Phantom to send USDC from the player's wallet to the platform wallet.
 * Returns the on-chain transaction signature on success.
 */
export async function sendUSDCDeposit(
  fromWalletAddress: string,
  amountCents: number
): Promise<DepositResult> {
  try {
    const provider = getPhantomProvider();
    if (!provider) return { success: false, error: 'Phantom wallet not found' };
    if (!_platformWallet) return { success: false, error: 'Platform wallet address not loaded — please refresh' };

    const connection  = getConnection();
    const fromPubkey  = new PublicKey(fromWalletAddress);
    const toPubkey    = new PublicKey(_platformWallet);
    const usdcMint    = getUSDCMint();

    const { getAssociatedTokenAddress, createTransferInstruction } = await import('@solana/spl-token');

    const sourceATA = await getAssociatedTokenAddress(usdcMint, fromPubkey);
    const destATA   = await getAssociatedTokenAddress(usdcMint, toPubkey);

    // USDC has 6 decimals. cents × 10,000 = atomic units.
    const atomicAmount = BigInt(amountCents) * BigInt(10_000);

    const transferIx = createTransferInstruction(
      sourceATA,
      destATA,
      fromPubkey,
      atomicAmount
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: fromPubkey });
    transaction.add(transferIx);

    const signedTx = await provider.signTransaction(transaction);
    const txSignature = await connection.sendRawTransaction(signedTx.serialize());
    await connection.confirmTransaction(txSignature, 'confirmed');

    return { success: true, txSignature };
  } catch (err: any) {
    console.error('USDC deposit failed:', err);
    return { success: false, error: err?.message || 'Transaction failed' };
  }
}
