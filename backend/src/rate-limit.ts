import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import type { Request } from 'express';

function createLimiter(limit: number, keyGenerator?: (req: Request) => string) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json({ status: 'error', error: 'rate_limited' });
    },
  });
}

// Все запросы к /api.
export const generalLimiter = createLimiter(config.rateLimitGeneralPerMin);

// Работает только после requireAuth: ключ это id пользователя.
export const heavyLimiter = createLimiter(
  config.rateLimitHeavyPerMin,
  (req) => `user:${req.user?.id ?? 'anonymous'}`,
);

// Регистрация и вход: защита от перебора паролей.
export const authLimiter = createLimiter(config.rateLimitAuthPerMin);