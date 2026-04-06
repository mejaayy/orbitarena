import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';

const USDC_MINT_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_MINT_DEVNET  = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const MAX_PRIMARY_RETRIES = 4;
const BASE_DELAY_MS = 1000;
const RPC_ERROR_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

interface RpcErrorEvent {
  timestamp: number;
  label: string;
  usedFallback: boolean;
}

const rpcErrorLog: RpcErrorEvent[] = [];

function recordRpcError(label: string, usedFallback: boolean) {
  const now = Date.now();
  rpcErrorLog.push({ timestamp: now, label, usedFallback });
  // Trim entries outside the window
  const cutoff = now - RPC_ERROR_WINDOW_MS;
  while (rpcErrorLog.length > 0 && rpcErrorLog[0].timestamp < cutoff) {
    rpcErrorLog.shift();
  }
}

export interface RpcErrorStatus {
  totalErrors: number;
  fallbackActivations: number;
  windowMinutes: number;
  isUnderPressure: boolean;
  isCritical: boolean;
  lastErrorAt: number | null;
}

export function getRpcErrorStatus(): RpcErrorStatus {
  const now = Date.now();
  const cutoff = now - RPC_ERROR_WINDOW_MS;
  const recent = rpcErrorLog.filter(e => e.timestamp >= cutoff);
  const fallbackCount = recent.filter(e => e.usedFallback).length;
  const lastEvent = recent[recent.length - 1] ?? null;
  return {
    totalErrors: recent.length,
    fallbackActivations: fallbackCount,
    windowMinutes: 10,
    isUnderPressure: recent.length >= 5,
    isCritical: recent.length >= 15 || fallbackCount >= 3,
    lastErrorAt: lastEvent ? lastEvent.timestamp : null,
  };
}

function solanaLog(message: string, level: string = 'solana') {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [${level}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function isRetryableError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed')
  );
}

export function getSolanaNetwork(): string {
  return process.env.SOLANA_NETWORK || 'mainnet-beta';
}

export function getUSDCMint(): PublicKey {
  return getSolanaNetwork() === 'devnet' ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
}

export function getServerConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (rpcUrl) {
    return new Connection(rpcUrl, 'confirmed');
  }
  const network = getSolanaNetwork();
  const defaultUrl = network === 'devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
  return new Connection(defaultUrl, 'confirmed');
}

function getPublicFallbackConnection(): Connection {
  const network = getSolanaNetwork();
  const url = network === 'devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
  return new Connection(url, 'confirmed');
}

/**
 * Runs fn against the primary connection with exponential backoff retries.
 * If the primary RPC keeps rate-limiting and a paid RPC is configured,
 * falls back to the free public Solana endpoint so operations continue
 * (slower, but not stopped).
 */
async function withRetryAndFallback<T>(
  fn: (connection: Connection) => Promise<T>,
  label: string
): Promise<T> {
  const primaryConn = getServerConnection();
  const hasDedicatedRpc = !!process.env.SOLANA_RPC_URL;

  // Try primary with exponential backoff
  let lastError: any;
  for (let attempt = 0; attempt < MAX_PRIMARY_RETRIES; attempt++) {
    try {
      return await fn(primaryConn);
    } catch (err: any) {
      lastError = err;
      if (!isRetryableError(err)) throw err; // Non-retryable (e.g. bad signature) — fail fast
      if (attempt < MAX_PRIMARY_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
        solanaLog(`${label}: rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_PRIMARY_RETRIES})`, 'warn');
        await sleep(delay);
      }
    }
  }

  // Primary exhausted — fall back to public endpoint (only useful if primary was a paid RPC)
  if (hasDedicatedRpc) {
    recordRpcError(label, true);
    solanaLog(`${label}: primary RPC exhausted after ${MAX_PRIMARY_RETRIES} attempts — switching to public endpoint (slower but operational)`, 'warn');
    const fallback = getPublicFallbackConnection();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn(fallback);
      } catch (err: any) {
        if (!isRetryableError(err)) throw err;
        if (attempt < 2) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt + 2); // 4s, 8s
          solanaLog(`${label}: public fallback also rate limited — retrying in ${delay}ms`, 'warn');
          await sleep(delay);
        }
      }
    }
  } else {
    // Primary is already public — just record the error
    recordRpcError(label, false);
  }

  throw lastError ?? new Error(`${label}: all RPC endpoints exhausted`);
}

export function getPlatformKeypair(): Keypair {
  const raw = process.env.PLATFORM_WALLET_PRIVATE_KEY;
  if (!raw) {
    throw new Error('PLATFORM_WALLET_PRIVATE_KEY is not set. Cannot execute on-chain withdrawals.');
  }
  try {
    const secretKey = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch {
    throw new Error('PLATFORM_WALLET_PRIVATE_KEY must be a JSON array of 64 bytes (e.g. [12,34,...])');
  }
}

export function getPlatformWalletAddress(): string {
  const addr = process.env.PLATFORM_WALLET_ADDRESS;
  if (!addr) {
    throw new Error('PLATFORM_WALLET_ADDRESS is not set.');
  }
  return addr;
}

export interface DepositVerificationResult {
  valid: boolean;
  error?: string;
  actualAmountCents?: number;
}

export async function verifyUSDCDeposit(
  txSignature: string,
  fromWalletAddress: string,
  expectedAmountCents: number
): Promise<DepositVerificationResult> {
  try {
    const platformWallet = getPlatformWalletAddress();
    const usdcMint = getUSDCMint();
    const mintStr = usdcMint.toBase58();

    solanaLog(`Verifying deposit tx ${txSignature.slice(0, 16)}... from ${fromWalletAddress.slice(0, 8)}...`);

    // Fetch the transaction — retry for both "not yet confirmed" and rate limit cases
    let tx = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        tx = await withRetryAndFallback(
          conn => conn.getParsedTransaction(txSignature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          }),
          'getParsedTransaction'
        );
        if (tx) break;
        // Transaction exists on network but not yet propagated — wait and retry
        await sleep(2500);
      } catch (err: any) {
        if (attempt === 4) throw err;
        await sleep(2500);
      }
    }

    if (!tx) {
      return { valid: false, error: 'Transaction not found on-chain — it may still be processing, please try confirming again in a moment.' };
    }

    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain' };
    }

    const preBalances  = tx.meta?.preTokenBalances  || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    const platformPost = postBalances.find(b => b.mint === mintStr && b.owner === platformWallet);
    const platformPre  = preBalances.find(b  => b.mint === mintStr && b.owner === platformWallet);

    if (!platformPost) {
      return { valid: false, error: 'No USDC credit to the platform wallet found in this transaction' };
    }

    const postAmt = platformPost.uiTokenAmount.uiAmount ?? 0;
    const preAmt  = platformPre?.uiTokenAmount.uiAmount ?? 0;
    const delta   = postAmt - preAmt;
    const actualAmountCents = Math.round(delta * 100);

    if (Math.abs(actualAmountCents - expectedAmountCents) > 1) {
      return {
        valid: false,
        error: `Amount mismatch: expected $${(expectedAmountCents / 100).toFixed(2)}, on-chain transfer was $${(actualAmountCents / 100).toFixed(2)}`,
      };
    }

    const senderPre = preBalances.find(b => b.mint === mintStr && b.owner === fromWalletAddress);
    const accountKeys = tx.transaction.message.accountKeys;
    const feePayer = typeof accountKeys[0] === 'string' ? accountKeys[0] : (accountKeys[0] as any).pubkey?.toBase58();

    if (!senderPre && feePayer !== fromWalletAddress) {
      return { valid: false, error: 'Transaction sender does not match the claimed wallet address' };
    }

    solanaLog(`Deposit verified: $${(actualAmountCents / 100).toFixed(2)} from ${fromWalletAddress.slice(0, 8)}...`);
    return { valid: true, actualAmountCents };
  } catch (err: any) {
    solanaLog(`Deposit verification error: ${err.message}`, 'error');
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}

export interface WithdrawalExecutionResult {
  success: boolean;
  error?: string;
  txSignature?: string;
}

export async function executeUSDCWithdrawal(
  toWalletAddress: string,
  amountCents: number
): Promise<WithdrawalExecutionResult> {
  try {
    const platformKp = getPlatformKeypair();
    const usdcMint   = getUSDCMint();
    const toPubkey   = new PublicKey(toWalletAddress);

    // USDC has 6 decimals. cents × 10,000 = USDC atomic units.
    const atomicAmount = BigInt(amountCents) * BigInt(10_000);

    solanaLog(`Executing withdrawal: $${(amountCents / 100).toFixed(2)} to ${toWalletAddress.slice(0, 8)}...`);

    const sourceATA = await getAssociatedTokenAddress(usdcMint, platformKp.publicKey);
    const destATA   = await getAssociatedTokenAddress(usdcMint, toPubkey);

    // --- Phase 1: Setup — fully retryable ---

    const instructions = [];
    try {
      await withRetryAndFallback(conn => getAccount(conn, destATA), 'getAccount');
    } catch {
      // ATA doesn't exist — platform creates it
      instructions.push(
        createAssociatedTokenAccountInstruction(platformKp.publicKey, destATA, toPubkey, usdcMint)
      );
    }

    instructions.push(
      createTransferInstruction(sourceATA, destATA, platformKp.publicKey, atomicAmount)
    );

    const { blockhash, lastValidBlockHeight } = await withRetryAndFallback(
      conn => conn.getLatestBlockhash('confirmed'),
      'getLatestBlockhash'
    );

    // --- Phase 2: Build and sign once, then send ---
    // Sending the same signed transaction bytes to multiple RPCs is safe —
    // Solana validators are idempotent for identical signed transactions.

    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: platformKp.publicKey });
    transaction.add(...instructions);
    transaction.sign(platformKp);
    const serialized = transaction.serialize();

    const txSignature = await withRetryAndFallback(
      conn => conn.sendRawTransaction(serialized, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      }),
      'sendRawTransaction'
    );

    // --- Phase 3: Confirm — retryable/fallback, same signature ---

    const confirmation = await withRetryAndFallback(
      conn => conn.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, 'confirmed'),
      'confirmTransaction'
    );

    if (confirmation.value.err) {
      return { success: false, error: 'On-chain withdrawal transaction failed to confirm' };
    }

    solanaLog(`Withdrawal complete: $${(amountCents / 100).toFixed(2)} to ${toWalletAddress.slice(0, 8)}... | tx: ${txSignature.slice(0, 20)}...`);
    return { success: true, txSignature };
  } catch (err: any) {
    solanaLog(`Withdrawal execution error: ${err.message}`, 'error');
    return { success: false, error: `Withdrawal failed: ${err.message}` };
  }
}
