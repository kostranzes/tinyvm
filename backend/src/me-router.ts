import { Router } from 'express';
import { requireAuth } from './auth-middleware.js';
import { pool } from './db.js';

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get('/submissions', async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, t.slug AS task, s.verdict, s.instruction_count, s.created_at
       FROM submissions s JOIN tasks t ON t.id = s.task_id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 50`,
    [req.user!.id],
  );

  res.json({
    status: 'ok',
    submissions: result.rows.map((row) => ({
      id: Number(row.id),
      task: row.task,
      verdict: row.verdict,
      instructionCount: row.instruction_count,
      createdAt: row.created_at,
    })),
  });
});

meRouter.get('/submissions/:id', async (req, res) => {
  const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  const result =
    id === null
      ? null
      : await pool.query(
          `SELECT s.id, t.slug AS task, s.source, s.verdict, s.instruction_count,
                  s.details, s.created_at
             FROM submissions s JOIN tasks t ON t.id = s.task_id
            WHERE s.id = $1 AND s.user_id = $2`,
          [id, req.user!.id],
        );
  const row = result?.rows[0];

  if (!row) {
    res.status(404).json({ status: 'error', error: 'submission_not_found' });
    return;
  }

  res.json({
    status: 'ok',
    submission: {
      id: Number(row.id),
      task: row.task,
      source: row.source,
      verdict: row.verdict,
      instructionCount: row.instruction_count,
      details: row.details,
      createdAt: row.created_at,
    },
  });
});