import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { z } from 'zod';
import { assemble } from './assemble.js';

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

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

const assembleBody = z.object({
  source: z.string(),
});

app.post('/api/assemble', async (req, res) => {
  const body = assembleBody.safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ status: 'error', error: 'invalid_request' });
    return;
  }

  const result = await assemble(body.data.source);

  if (!result.ok) {
    const status = result.error === 'internal_error' ? 503 : 400;
    res.status(status).json({ status: 'error', error: result.error, message: result.message });
    return;
  }

  res.json({
    status: 'ok',
    size: result.code.length,
    codeHex: result.code.toString('hex'),
  });
});

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
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error('Error while closing the pool:', error);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));