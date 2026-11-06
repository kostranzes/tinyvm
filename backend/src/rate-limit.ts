import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';

function createLimiter(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ status: 'error', error: 'rate_limited' });
    },
  });
}

// Все запросы к /api.
export const generalLimiter = createLimiter(config.rateLimitGeneralPerMin);

// Запросы, которые запускают Docker (сборка NASM и контейнер движка).
// Один экземпляр на три маршрута, поэтому счётчик у них общий.
export const heavyLimiter = createLimiter(config.rateLimitHeavyPerMin);

// Регистрация и вход: защита от перебора паролей.
export const authLimiter = createLimiter(config.rateLimitAuthPerMin);