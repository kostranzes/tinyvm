import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { pool } from './db.js';

export const tasksRouter = Router();

const slugSchema = z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

function notFound(res: Response): void {
  res.status(404).json({ status: 'error', error: 'task_not_found' });
}

tasksRouter.get('/', async (_req, res) => {
  const result = await pool.query(
    'SELECT slug, title, difficulty FROM tasks ORDER BY created_at, id',
  );
  res.json({ status: 'ok', tasks: result.rows });
});

tasksRouter.get('/:slug', async (req, res) => {
  const slug = slugSchema.safeParse(req.params.slug);
  if (!slug.success) {
    notFound(res);
    return;
  }

  const taskResult = await pool.query(
    `SELECT id, slug, title, description, starter_code, instruction_limit, difficulty
       FROM tasks WHERE slug = $1`,
    [slug.data],
  );
  const task = taskResult.rows[0];
  if (!task) {
    notFound(res);
    return;
  }

  // Скрытые тесты отфильтрованы здесь, в запросе: их данные даже не читаются из базы.
  const visible = await pool.query(
    `SELECT position, input, expected
       FROM task_tests
      WHERE task_id = $1 AND is_hidden = false
      ORDER BY position`,
    [task.id],
  );
  const hidden = await pool.query(
    'SELECT count(*)::int AS count FROM task_tests WHERE task_id = $1 AND is_hidden = true',
    [task.id],
  );

  res.json({
    status: 'ok',
    task: {
      slug: task.slug,
      title: task.title,
      description: task.description,
      starterCode: task.starter_code,
      instructionLimit: task.instruction_limit,
      difficulty: task.difficulty,
      visibleTests: visible.rows,
      hiddenTestCount: hidden.rows[0].count,
    },
  });
});