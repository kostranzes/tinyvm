import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { tryAcquire } from './limiter.js';
import { prepareSession, runRequestSchema, u64String } from './run-program.js';
import { SessionError } from './session-client.js';
import type { SessionResponse, TinyVmSession } from './session-client.js';
import { addSession, getSession, removeSession, reserveSession } from './session-store.js';

export const sessionsRouter = Router();

const createSchema = runRequestSchema.omit({ readMemory: true });

const stepSchema = z.object({
  count: z.number().int().min(1).max(100).default(1),
});

const memorySchema = z.object({
  address: u64String,
  size: z.number().int().min(1).max(4096),
});

const idSchema = z.uuid();

function view(response: SessionResponse) {
  return {
    status: response.status,
    instructionCount: response.instruction_count,
    registers: response.registers,
    error: response.error,
  };
}

function invalidRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({
    status: 'error',
    error: 'invalid_request',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

// Находит сессию, выполняет действие и превращает падение движка в 410.
async function withSession(
  req: Request,
  res: Response,
  action: (session: TinyVmSession) => Promise<void>,
): Promise<void> {
  const id = idSchema.safeParse(req.params.id);
  const session = id.success ? getSession(id.data) : undefined;

  if (!id.success || !session) {
    res.status(404).json({ status: 'error', error: 'session_not_found' });
    return;
  }

  try {
    await action(session);
  } catch (error) {
    if (error instanceof SessionError) {
      console.error('Session lost:', id.data, error.code, error.message);
      await removeSession(id.data);
      res.status(410).json({ status: 'error', error: 'session_lost' });
      return;
    }
    throw error;
  }
}

sessionsRouter.post('/', async (req, res) => {
  const body = createSchema.safeParse(req.body);
  if (!body.success) {
    invalidRequest(res, body.error);
    return;
  }

  const releaseSlot = reserveSession();
  if (!releaseSlot) {
    res.status(503).json({ status: 'error', error: 'too_many_sessions' });
    return;
  }

  // Подготовка запускает Docker для NASM, поэтому занимает слот общего лимита.
  const releaseRun = tryAcquire();
  if (!releaseRun) {
    releaseSlot();
    res.status(503).json({ status: 'error', error: 'busy' });
    return;
  }

  try {
    const outcome = await prepareSession(body.data);

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
      case 'prepared': {
        const sessionId = addSession(outcome.session);
        res.status(201).json({
          status: 'ok',
          sessionId,
          codeSize: outcome.codeSize,
          state: view(outcome.state),
          disassembly: outcome.disassembly.disassembly,
        });
        return;
      }
    }
  } finally {
    releaseRun();
    releaseSlot();
  }
});

sessionsRouter.post('/:id/step', (req, res) =>
  withSession(req, res, async (session) => {
    const body = stepSchema.safeParse(req.body ?? {});
    if (!body.success) {
      invalidRequest(res, body.error);
      return;
    }

    let response: SessionResponse | null = null;
    let steps = 0;
    for (let i = 0; i < body.data.count; i++) {
      response = await session.step();
      steps++;
      // Остановка на ошибке или завершении программы.
      if (response.error !== null || response.status !== 'running') break;
    }

    res.json({ status: 'ok', steps, state: view(response!) });
  }),
);

sessionsRouter.post('/:id/run', (req, res) =>
  withSession(req, res, async (session) => {
    res.json({ status: 'ok', state: view(await session.run()) });
  }),
);

sessionsRouter.get('/:id/state', (req, res) =>
  withSession(req, res, async (session) => {
    const [state, disassembly] = [await session.state(), await session.disassemble()];
    res.json({
      status: 'ok',
      state: view(state),
      disassembly: disassembly.disassembly ?? null,
    });
  }),
);

sessionsRouter.post('/:id/memory', (req, res) =>
  withSession(req, res, async (session) => {
    const body = memorySchema.safeParse(req.body);
    if (!body.success) {
      invalidRequest(res, body.error);
      return;
    }

    const response = await session.readMemory(BigInt(body.data.address), body.data.size);
    res.json({
      status: 'ok',
      address: body.data.address,
      size: body.data.size,
      data: response.error === null ? (response.data ?? null) : null,
      error: response.error,
    });
  }),
);

sessionsRouter.delete('/:id', async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const removed = id.success && (await removeSession(id.data));

  if (!removed) {
    res.status(404).json({ status: 'error', error: 'session_not_found' });
    return;
  }
  res.json({ status: 'ok' });
});