import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

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
    phantom?: {
      solana?: PhantomProvider;
    };
    solana?: PhantomProvider;
  }
}

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  if (window.solana?.isPhantom) return window.solana;
  return null;
}

export const SOLANA_NETWORK = 'devnet';
export const USDC_MINT_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const PLATFORM_WALLET = new PublicKey('11111111111111111111111111111111');
export const ENTRY_FEE_USDC = 1;
export const EXIT_FEE_PERCENT = 10;

export function getConnection(): Connection {
  return new Connection(clusterApiUrl(SOLANA_NETWORK), 'confirmed');
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
  if (provider) {
    await provider.disconnect();
  }
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
    const tokenAccount = await getAssociatedTokenAddress(USDC_MINT_DEVNET, wallet);
    
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
