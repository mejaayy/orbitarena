import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from './db';
import { adminAuth, adminSessions } from '@shared/schema';
import { eq, lt } from 'drizzle-orm';

const SALT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 24;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export { MIN_PASSWORD_LENGTH };

function maskSensitiveData(data: string): string {
  if (data.length <= 8) return '****';
  return data.slice(0, 4) + '****' + data.slice(-4);
}

function log(message: string, type: string = 'admin') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} [${type}] ${message}`);
}

export async function hasAdminPassword(): Promise<boolean> {
  const existing = await db.query.adminAuth.findFirst();
  return !!existing;
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be less than ${MAX_PASSWORD_LENGTH} characters` };
  }
  return { valid: true };
}

export async function setAdminPassword(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const existing = await db.query.adminAuth.findFirst();
    
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    
    if (existing) {
      await db.update(adminAuth)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(adminAuth.id, existing.id));
      log('Admin password updated');
    } else {
      await db.insert(adminAuth).values({ passwordHash });
      log('Admin password created');
    }
    
    return { success: true };
  } catch (error: any) {
    log(`Failed to set password: ${error.message}`, 'error');
    return { success: false, error: 'Failed to set password' };
  }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  try {
    const existing = await db.query.adminAuth.findFirst();
    if (!existing) return false;
    
    return await bcrypt.compare(password, existing.passwordHash);
  } catch (error: any) {
    log(`Password verification failed: ${error.message}`, 'error');
    return false;
  }
}

export async function createAdminSession(): Promise<string | null> {
  try {
    await db.delete(adminSessions)
      .where(lt(adminSessions.expiresAt, new Date()));
    
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
    
    await db.insert(adminSessions).values({ token, expiresAt });
    
    log(`Admin session created (expires in ${SESSION_DURATION_HOURS}h)`);
    return token;
  } catch (error: any) {
    log(`Failed to create session: ${error.message}`, 'error');
    return null;
  }
}

export async function validateAdminSession(token: string): Promise<boolean> {
  try {
    if (!token) return false;
    
    const session = await db.query.adminSessions.findFirst({
      where: eq(adminSessions.token, token),
    });
    
    if (!session) return false;
    
    if (new Date() > session.expiresAt) {
      await db.delete(adminSessions).where(eq(adminSessions.id, session.id));
      return false;
    }
    
    return true;
  } catch (error: any) {
    log(`Session validation failed: ${error.message}`, 'error');
    return false;
  }
}

export async function invalidateAdminSession(token: string): Promise<void> {
  try {
    await db.delete(adminSessions).where(eq(adminSessions.token, token));
    log('Admin session invalidated');
  } catch (error: any) {
    log(`Failed to invalidate session: ${error.message}`, 'error');
  }
}

export { maskSensitiveData };
