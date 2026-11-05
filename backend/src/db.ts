import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

// Без этого обработчика ошибка на простаивающем соединении роняет процесс.
pool.on('error', (error) => {
  console.error('Unexpected error on idle PostgreSQL client:', error);
});