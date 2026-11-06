import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { tryAcquire } from './limiter.js';
import { judgeSubmission } from './judge.js';
import type { TestRow } from './judge.js';
import { heavyLimiter } from './rate-limit.js';

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

const submitSchema = z.object({ source: z.string() });

tasksRouter.post('/:slug/submit', heavyLimiter, async (req, res) => {
  const slug = slugSchema.safeParse(req.params.slug);
  if (!slug.success) {
    notFound(res);
    return;
  }

  const body = submitSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ status: 'error', error: 'invalid_request' });
    return;
  }

  const taskResult = await pool.query(
    'SELECT id, instruction_limit FROM tasks WHERE slug = $1',
    [slug.data],
  );
  const task = taskResult.rows[0];
  if (!task) {
    notFound(res);
    return;
  }

  // Здесь читаются все тесты, включая скрытые. Пользователю они не отдаются.
  const testsResult = await pool.query<TestRow>(
    `SELECT position, is_hidden, input, expected
       FROM task_tests WHERE task_id = $1 ORDER BY position`,
    [task.id],
  );
  if (testsResult.rows.length === 0) {
    console.error('Task has no tests:', slug.data);
    res.status(503).json({ status: 'error', error: 'task_unavailable' });
    return;
  }

  const release = tryAcquire();
  if (!release) {
    res.status(503).json({ status: 'error', error: 'busy' });
    return;
  }

  try {
    const outcome = await judgeSubmission(
      body.data.source,
      task.instruction_limit,
      testsResult.rows,
    );

    if (outcome.kind === 'unavailable') {
      res.status(503).json({ status: 'error', error: 'engine_unavailable' });
      return;
    }

    const details = {
      passed: outcome.passed,
      total: outcome.total,
      failedPosition: outcome.failed?.position ?? null,
      failedHidden: outcome.failed?.hidden ?? null,
      message: outcome.message ?? null,
    };

    const saved = await pool.query(
      `INSERT INTO submissions (task_id, source, verdict, instruction_count, details)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [task.id, body.data.source, outcome.verdict, outcome.instructionCount, JSON.stringify(details)],
    );

    // Для скрытого теста наружу уходят только номер и пометка hidden.
    const failedTest = outcome.failed && {
      position: outcome.failed.position,
      hidden: outcome.failed.hidden,
      engineError: outcome.failed.engineError,
      mismatches: outcome.failed.hidden ? undefined : outcome.failed.mismatches,
    };

    res.json({
      status: 'ok',
      submissionId: Number(saved.rows[0].id),
      verdict: outcome.verdict,
      passed: outcome.passed,
      total: outcome.total,
      instructionCount: outcome.instructionCount,
      message: outcome.message,
      failedTest,
    });
  } finally {
    release();
  }
});