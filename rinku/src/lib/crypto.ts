import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const VAULT_RAW = process.env.ERP_VAULT_KEY || 'titangrid-erp-vault-key-2026-default';
const VAULT_KEY = crypto.createHash('sha256').update(VAULT_RAW).digest();
const JWT_SECRET = process.env.ERP_JWT_SECRET || 'titangrid-erp-jwt-secret-2026-default';

export interface SessionPayload {
  userId: string;
  tenantId: string;
  branchId: string | null;
  role: 'super_admin' | 'owner' | 'branch_manager' | 'cashier' | 'salesman' | 'accountant';
  email: string;
  fullName: string;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifySessionToken(token: string): SessionPayload {
  return jwt.verify(token, JWT_SECRET) as SessionPayload;
}

export function encryptJson(data: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptJson<T = Record<string, unknown>>(payload: string | null | undefined): T {
  if (!payload) return {} as T;
  try {
    const parts = payload.split(':');
    if (parts.length !== 3) return JSON.parse(payload) as T;
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return {} as T;
  }
}

const SENSITIVE_KEYS = [
  'apiKey',
  'accessToken',
  'appSecret',
  'verifyToken',
  'serviceAccountJson',
  'password',
  'dsn',
  'secret',
  'privateKey',
];

export function maskSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.length > 0 && SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
      const tail = value.length > 4 ? value.slice(-4) : '****';
      out[key] = `••••••••${tail}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function mergeMaskedConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'string' && value.startsWith('••••••••')) {
      continue; // Keep existing secret unchanged if masked placeholder submitted
    }
    merged[key] = value;
  }
  return merged;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
