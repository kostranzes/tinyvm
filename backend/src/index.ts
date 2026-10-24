import { pool } from './db.js';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();

const PORT = Number(process.env.PORT ?? 3000);

app.use(cors({
  origin: 'http://localhost:5173',
}));

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

app.listen(PORT, () => {
  console.log(`TinyVM backend: http://localhost:${PORT}`);
});
