import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

// backend/migrations: путь верный и из src/, и из dist/.
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK_ID = 727001; // чтобы два раннера не работали одновременно

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;

      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed`, { cause: error });
      }

      console.log(`applied ${file}`);
      applied++;
    }

    if (applied === 0) console.log('nothing to apply');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await pool.end();
    process.exit(1);
  });