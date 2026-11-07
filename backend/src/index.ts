import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { runProgram, runRequestSchema } from './run-program.js';
import { tryAcquire } from './limiter.js';
import { sessionsRouter } from './sessions-router.js';
import { closeAllSessions } from './session-store.js';
import { tasksRouter } from './tasks-router.js';
import helmet from 'helmet';
import { generalLimiter, heavyLimiter } from './rate-limit.js';
import { authRouter } from './auth-router.js';
import { requireAuth } from './auth-middleware.js';
import { meRouter } from './me-router.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));

// Небольшая защита от CSRF сверх SameSite=Lax: небезопасные запросы с чужого
// сайта отклоняются. Запросы без заголовка Origin (curl, тесты) проходят.
app.use((req, res, next) => {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const origin = req.headers.origin;

  if (unsafe && origin !== undefined && origin !== config.corsOrigin) {
    res.status(403).json({ status: 'error', error: 'forbidden_origin' });
    return;
  }
  next();
});

app.use('/api', generalLimiter);
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'tinyvm-backend',
  });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS server_time');

    res.json({
      status: 'ok',
      database: 'connected',
      serverTime: result.rows[0].server_time,
    });
  } catch (error) {
    console.error('Database connection error:', error);

    res.status(503).json({
      status: 'error',
      database: 'unavailable',
    });
  }
});

app.post('/api/run', requireAuth, heavyLimiter, async (req, res) => {
  const body = runRequestSchema.safeParse(req.body);

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

  const release = tryAcquire();
  if (!release) {
    res.status(503).json({ status: 'error', error: 'busy' });
    return;
  }

  try {
    const outcome = await runProgram(body.data);

    switch (outcome.kind) {
      case 'assemble_failed':
        res
          .status(outcome.error === 'internal_error' ? 503 : 400)
          .json({ status: 'error', error: outcome.error, message: outcome.message });
        return;
      case 'setup_failed':
        res.status(400).json({
          status: 'error',
          error: 'setup_failed',
          stage: outcome.stage,
          engineError: outcome.error,
        });
        return;
      case 'engine_unavailable':
        res.status(503).json({ status: 'error', error: 'engine_unavailable' });
        return;
      case 'ok':
        res.json({
          status: 'ok',
          codeSize: outcome.codeSize,
          result: {
            status: outcome.result.status,
            instructionCount: outcome.result.instruction_count,
            registers: outcome.result.registers,
            error: outcome.result.error,
          },
          memory: outcome.memory,
        });
        return;
    }
  } finally {
    release();
  }
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);

// Неизвестный маршрут.
app.use((_req, res) => {
  res.status(404).json({ status: 'error', error: 'not_found' });
});

// Общий обработчик ошибок. Четыре аргумента обязательны: по ним Express
// понимает, что это обработчик ошибок.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error('Unhandled error:', error);
    res.status(500).json({ status: 'error', error: 'internal_error' });
    return;
  }

  // Ошибки клиента, например невалидный JSON в теле запроса.
  res.status(status).json({ status: 'error', error: 'bad_request' });
});

const server = app.listen(config.port, () => {
  console.log(`TinyVM backend: http://localhost:${config.port}`);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);

  // Страховка: если что-то зависло, выходим принудительно.
  setTimeout(() => process.exit(1), 10_000).unref();

  server.close(async () => {
    try {
      await closeAllSessions();
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('Error while shutting down:', error);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));