import { describe, expect, it } from 'vitest';

const BASE = process.env.TINYVM_E2E_URL ?? 'http://localhost:3000';

const ARRAY_SUM = [
  'xor rax, rax',
  'xor rcx, rcx',
  'test rsi, rsi',
  'jz done',
  'loop_start:',
  'add rax, [rdi + rcx * 8]',
  'inc rcx',
  'cmp rcx, rsi',
  'jb loop_start',
  'done:',
].join('\n');

// Проходит видимый тест, проваливает скрытый.
const WRONG_ON_HIDDEN = 'xor rax, rax\ntest rsi, rsi\njz d\nmov rax, 10\nd:';

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as Record<string, any> };
}

// Нужны запущенный backend (npm run dev), Docker с образами tinyvm-nasm и
// tinyvm-engine и база с миграциями. Тесты отправки решений добавляют строки
// в таблицу submissions.
describe.skipIf(!process.env.TINYVM_E2E)('сквозные проверки через HTTP', () => {
  it('POST /api/run: сложение регистров', async () => {
    const { status, json } = await call('POST', '/api/run', {
      source: 'mov rax, rdi\nadd rax, rsi',
      registers: { rdi: '2', rsi: '3' },
    });

    expect(status).toBe(200);
    expect(json.result.status).toBe('finished');
    expect(json.result.instructionCount).toBe(2);
    expect(json.result.registers.rax).toBe('0x0000000000000005');
  });

  it('POST /api/run: максимальный лимит инструкций проходит', async () => {
    const { status, json } = await call('POST', '/api/run', {
      source: 'l: jmp l',
      instructionLimit: 1_000_000,
    });

    expect(status).toBe(200);
    expect(json.result.status).toBe('limit_exceeded');
    expect(json.result.instructionCount).toBe(1_000_000);
  });

  it('POST /api/run: ошибка сборки и запрещённая директива', async () => {
    const broken = await call('POST', '/api/run', { source: 'foo rax' });
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe('assembly_failed');

    const forbidden = await call('POST', '/api/run', { source: '%include "/etc/passwd"' });
    expect(forbidden.status).toBe(400);
    expect(forbidden.json.error).toBe('forbidden_directive');
  });

  it('отладочная сессия: создание, шаги, удаление', async () => {
    const created = await call('POST', '/api/sessions', {
      source: 'mov rax, rdi\nadd rax, rsi',
      registers: { rdi: '2', rsi: '3' },
    });
    expect(created.status).toBe(201);
    const id = created.json.sessionId as string;

    const first = await call('POST', `/api/sessions/${id}/step`);
    expect(first.json.state.status).toBe('running');

    const second = await call('POST', `/api/sessions/${id}/step`);
    expect(second.json.state.status).toBe('finished');
    expect(second.json.state.registers.rax).toBe('0x0000000000000005');

    expect((await call('DELETE', `/api/sessions/${id}`)).status).toBe(200);
    expect((await call('GET', `/api/sessions/${id}/state`)).status).toBe(404);
  });

  it('GET /api/tasks/array-sum не раскрывает скрытые тесты', async () => {
    const { status, text, json } = await call('GET', '/api/tasks/array-sum');

    expect(status).toBe(200);
    expect(json.task.visibleTests).toHaveLength(1);
    expect(json.task.hiddenTestCount).toBe(2);
    // Данные скрытого теста [42] не должны встречаться в ответе.
    expect(text).not.toContain('2a00000000000000');
  });

  it('POST submit: верное решение принимается', async () => {
    const { status, json } = await call('POST', '/api/tasks/array-sum/submit', {
      source: ARRAY_SUM,
    });

    expect(status).toBe(200);
    expect(json.verdict).toBe('accepted');
    expect(json.passed).toBe(3);
    expect(json.total).toBe(3);
  });

  it('POST submit: провал скрытого теста не раскрывает его данные', async () => {
    const { status, json } = await call('POST', '/api/tasks/array-sum/submit', {
      source: WRONG_ON_HIDDEN,
    });

    expect(status).toBe(200);
    expect(json.verdict).toBe('wrong_answer');
    expect(json.passed).toBe(1);
    expect(json.failedTest.hidden).toBe(true);
    expect(json.failedTest.position).toBe(2);
    expect(json.failedTest).not.toHaveProperty('mismatches');
  });

  it('POST submit: несуществующее задание', async () => {
    const { status, json } = await call('POST', '/api/tasks/nope/submit', { source: 'nop' });

    expect(status).toBe(404);
    expect(json.error).toBe('task_not_found');
  });
});