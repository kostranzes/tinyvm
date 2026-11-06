import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createLoginSession,
  deleteLoginSession,
} from './auth.js';
import { readSessionToken, requireAuth } from './auth-middleware.js';
import { config } from './config.js';
import { pool } from './db.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import { authLimiter } from './rate-limit.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

const registerSchema = z.object({
  email,
  password: z.string().min(10).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(128),
});

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
  );
}

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = registerSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({
      status: 'error',
      error: 'invalid_request',
      issues: body.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const passwordHash = await hashPassword(body.data.password);

  try {
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [body.data.email, passwordHash],
    );
    const user = { id: Number(result.rows[0].id), email: result.rows[0].email as string };

    setSessionCookie(res, await createLoginSession(user.id));
    res.status(201).json({ status: 'ok', user });
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ status: 'error', error: 'email_taken' });
      return;
    }
    throw error;
  }
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ status: 'error', error: 'invalid_request' });
    return;
  }

  const found = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE lower(email) = $1',
    [body.data.email],
  );
  const row = found.rows[0];

  // Для неизвестного email проверяем пароль против фиктивного хэша.
  const ok = await verifyPassword(
    body.data.password,
    row ? (row.password_hash as string) : await getDummyHash(),
  );

  if (!row || !ok) {
    res.status(401).json({ status: 'error', error: 'invalid_credentials' });
    return;
  }

  setSessionCookie(res, await createLoginSession(Number(row.id)));
  res.json({ status: 'ok', user: { id: Number(row.id), email: row.email as string } });
});

authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) await deleteLoginSession(token);

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
  res.json({ status: 'ok' });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ status: 'ok', user: req.user });
});