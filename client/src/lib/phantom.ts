import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

declare global {
  interface Window {
    phantom?: {
      solana?: {
        isPhantom: boolean;
        connect: () => Promise<{ publicKey: PublicKey }>;
        disconnect: () => Promise<void>;
        signTransaction: (transaction: any) => Promise<any>;
        signAllTransactions: (transactions: any[]) => Promise<any[]>;
        publicKey: PublicKey | null;
        isConnected: boolean;
        on: (event: string, callback: (args: any) => void) => void;
        off: (event: string, callback: (args: any) => void) => void;
      };
    };
  }
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
  return typeof window !== 'undefined' && !!window.phantom?.solana?.isPhantom;
}

export async function connectPhantom(): Promise<string | null> {
  if (!isPhantomInstalled()) {
    window.open('https://phantom.app/', '_blank');
    return null;
  }

  try {
    const response = await window.phantom!.solana!.connect();
    return response.publicKey.toBase58();
  } catch (error) {
    console.error('Failed to connect Phantom:', error);
    return null;
  }
}

export async function disconnectPhantom(): Promise<void> {
  if (window.phantom?.solana) {
    await window.phantom.solana.disconnect();
  }
}

export function getConnectedWallet(): string | null {
  if (window.phantom?.solana?.isConnected && window.phantom.solana.publicKey) {
    return window.phantom.solana.publicKey.toBase58();
  }
  return null;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
