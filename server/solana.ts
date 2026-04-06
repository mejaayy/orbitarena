import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';

const USDC_MINT_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_MINT_DEVNET  = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

function solanaLog(message: string, level: string = 'solana') {
  const ts = new Date().toLocaleTimeString();
  console.log(`${ts} [${level}] ${message}`);
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
  solanaLog(`No SOLANA_RPC_URL configured — using default: ${defaultUrl}`, 'warn');
  return new Connection(defaultUrl, 'confirmed');
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
    const connection = getServerConnection();
    const platformWallet = getPlatformWalletAddress();
    const usdcMint = getUSDCMint();

    solanaLog(`Verifying deposit tx ${txSignature.slice(0, 16)}... from ${fromWalletAddress.slice(0, 8)}...`);

    // Retry up to 3 times waiting for finality
    let tx = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      tx = await connection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
      await new Promise(r => setTimeout(r, 2500));
    }

    if (!tx) {
      return { valid: false, error: 'Transaction not found on-chain — it may still be processing, please retry.' };
    }

    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain' };
    }

    const preBalances  = tx.meta?.preTokenBalances  || [];
    const postBalances = tx.meta?.postTokenBalances || [];
    const mintStr = usdcMint.toBase58();

    // Find platform wallet balance change for USDC
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

    // Verify the sender owns the source USDC token account
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
    const connection    = getServerConnection();
    const platformKp    = getPlatformKeypair();
    const usdcMint      = getUSDCMint();
    const toPubkey      = new PublicKey(toWalletAddress);

    // USDC has 6 decimals. cents × 10,000 = USDC atomic units.
    const atomicAmount = BigInt(amountCents) * BigInt(10_000);

    solanaLog(`Executing withdrawal: $${(amountCents / 100).toFixed(2)} to ${toWalletAddress.slice(0, 8)}...`);

    const sourceATA = await getAssociatedTokenAddress(usdcMint, platformKp.publicKey);
    const destATA   = await getAssociatedTokenAddress(usdcMint, toPubkey);

    const instructions = [];

    // Create destination ATA if it doesn't exist yet (platform pays rent)
    try {
      await getAccount(connection, destATA);
    } catch {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          platformKp.publicKey,
          destATA,
          toPubkey,
          usdcMint
        )
      );
    }

    instructions.push(
      createTransferInstruction(
        sourceATA,
        destATA,
        platformKp.publicKey,
        atomicAmount
      )
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: platformKp.publicKey });
    transaction.add(...instructions);
    transaction.sign(platformKp);

    const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    const confirmation = await connection.confirmTransaction(
      { signature: txSignature, blockhash, lastValidBlockHeight },
      'confirmed'
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
