import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SessionError, TinyVmSession } from '../src/session-client.js';

const REPLY =
  '{"status":"ready","instruction_count":0,"registers":null,"error":null}';

let dir: string;
const opened: TinyVmSession[] = [];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'tinyvm-fake-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((session) => session.close()));
});

// Поддельный движок: shell-скрипт. Дочерний процесс получает пустое окружение,
// поэтому используем только встроенные команды sh.
function fakeEngine(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function open(binaryPath: string, commandTimeoutMs?: number): TinyVmSession {
  const session = new TinyVmSession({
    mode: 'host',
    binaryPath,
    image: 'unused',
    commandTimeoutMs,
  });
  opened.push(session);
  return session;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SessionError) return error.code;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('TinyVmSession на поддельном движке', () => {
  it('обменивается строками JSON', async () => {
    const session = open(
      fakeEngine('echo.sh', `while read line; do echo '${REPLY}'; done`),
    );

    const response = await session.state();

    expect(response.status).toBe('ready');
    expect(response.error).toBeNull();
    expect(session.alive).toBe(true);
  });

  it('одновременные запросы выстраиваются в очередь', async () => {
    const session = open(
      fakeEngine('queue.sh', `while read line; do echo '${REPLY}'; done`),
    );

    const responses = await Promise.all([session.state(), session.state(), session.state()]);

    expect(responses).toHaveLength(3);
  });

  it('close() можно вызывать повторно', async () => {
    const session = open(
      fakeEngine('close.sh', `while read line; do echo '${REPLY}'; done`),
    );

    await session.state();
    await session.close();
    await session.close();

    expect(session.alive).toBe(false);
    expect(await codeOf(session.state())).toBe('session_closed');
  });

  it('падение процесса даёт process_exited, дальше сессия мертва', async () => {
    const session = open(fakeEngine('crash.sh', 'read line\nexit 3'));

    expect(await codeOf(session.state())).toBe('process_exited');
    expect(session.alive).toBe(false);
    expect(await codeOf(session.state())).toBe('process_exited');
  });

  it('молчащий процесс даёт timeout и убивается', async () => {
    const session = open(fakeEngine('silent.sh', 'while read line; do :; done'), 200);

    expect(await codeOf(session.state())).toBe('timeout');
    expect(session.alive).toBe(false);
  });

  it('ответ не в формате JSON даёт protocol_violation', async () => {
    const session = open(fakeEngine('garbage.sh', 'read line\necho garbage'));

    expect(await codeOf(session.state())).toBe('protocol_violation');
  });

  it('JSON без нужных полей даёт protocol_violation', async () => {
    const session = open(fakeEngine('shape.sh', `read line\necho '{"foo":1}'`));

    expect(await codeOf(session.state())).toBe('protocol_violation');
  });

  it('несуществующий бинарник даёт spawn_failed', async () => {
    const session = open('/nonexistent/tinyvm-session');

    expect(await codeOf(session.state())).toBe('spawn_failed');
  });

  it('не отдаёт процессу переменные окружения backend', async () => {
    // В vitest.config.ts DATABASE_URL задан, поэтому он есть в process.env.
    expect(process.env.DATABASE_URL).toBeTruthy();

    const body =
      'read line\n' +
      'echo "{\\"status\\":\\"ready\\",\\"instruction_count\\":0,' +
      '\\"registers\\":null,\\"error\\":\\"[$DATABASE_URL]\\"}"';
    const session = open(fakeEngine('env.sh', body));

    const response = await session.state();

    expect(response.error).toBe('[]');
  });
});