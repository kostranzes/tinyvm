import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';

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