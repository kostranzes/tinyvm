import { createHash, randomBytes } from 'node:crypto';
import { pool } from './db.js';

export const SESSION_COOKIE = 'tinyvm_sid';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: number;
  email: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createLoginSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');

  await pool.query(
    `INSERT INTO login_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
    [hashToken(token), userId, String(SESSION_TTL_MS)],
  );

  return token;
}

export async function findUserByToken(token: string): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT u.id, u.email
       FROM login_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  return row ? { id: Number(row.id), email: row.email } : null;
}

export async function deleteLoginSession(token: string): Promise<void> {
  await pool.query('DELETE FROM login_sessions WHERE token_hash = $1', [hashToken(token)]);
}

// Просроченные записи раз в час удаляются.
const cleaner = setInterval(() => {
  pool
    .query('DELETE FROM login_sessions WHERE expires_at < now()')
    .catch((error) => console.error('Failed to clean login sessions:', error));
}, 60 * 60_000);
cleaner.unref();