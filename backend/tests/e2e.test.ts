import { describe, expect, it, beforeAll } from 'vitest';

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

const auth = { cookie: '' };

async function call(method: string, path: string, body?: unknown, cookie: string = auth.cookie) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
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

  const REFERENCE: Record<string, string> = {
    'array-max': [
      'mov rax, [rdi]',
      'mov rcx, 1',
      'check:',
      'cmp rcx, rsi',
      'jae done',
      'mov rdx, [rdi + rcx * 8]',
      'cmp rdx, rax',
      'jbe skip',
      'mov rax, rdx',
      'skip:',
      'inc rcx',
      'jmp check',
      'done:',
    ].join('\n'),
    'array-reverse': [
      'test rsi, rsi',
      'jz done',
      'lea rdx, [rdi + rsi * 8 - 8]',
      'again:',
      'cmp rdi, rdx',
      'jae done',
      'mov rax, [rdi]',
      'mov rcx, [rdx]',
      'mov [rdi], rcx',
      'mov [rdx], rax',
      'add rdi, 8',
      'sub rdx, 8',
      'jmp again',
      'done:',
    ].join('\n'),
    factorial: [
      'mov rax, 1',
      'again:',
      'test rdi, rdi',
      'jz done',
      'imul rax, rdi',
      'dec rdi',
      'jmp again',
      'done:',
    ].join('\n'),
  };

  it('GET /api/tasks: четыре задания', async () => {
    const { json } = await call('GET', '/api/tasks');
    const slugs = (json.tasks as Array<{ slug: string }>).map((task) => task.slug);

    expect(slugs).toEqual(
      expect.arrayContaining(['array-sum', 'array-max', 'array-reverse', 'factorial']),
    );
  });

  it.each(Object.keys(REFERENCE))('эталонное решение %s принимается', async (slug) => {
    const { status, json } = await call('POST', `/api/tasks/${slug}/submit`, {
      source: REFERENCE[slug],
    });

    expect(status).toBe(200);
    expect(json.verdict, JSON.stringify(json)).toBe('accepted');
    expect(json.passed).toBe(json.total);
  });

  it('array-max: решение со знаковым сравнением не проходит', async () => {
    const source = REFERENCE['array-max']!.replace('jbe skip', 'jle skip');
    const { json } = await call('POST', '/api/tasks/array-max/submit', { source });

    expect(json.verdict).toBe('wrong_answer');
    expect(json.failedTest.hidden).toBe(true);
    expect(json.failedTest).not.toHaveProperty('mismatches');
  });

  it('array-reverse: пустая программа не проходит, расхождение по памяти видно', async () => {
    const { json } = await call('POST', '/api/tasks/array-reverse/submit', { source: 'nop' });

    expect(json.verdict).toBe('wrong_answer');
    expect(json.failedTest.hidden).toBe(false);
    expect(json.failedTest.mismatches[0].what).toContain('memory 0x110000');
  });

  async function authCall(method: string, path: string, body?: unknown, cookie?: string) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie().join('; ');
    const match = /tinyvm_sid=([^;]*)/.exec(setCookie);
    return {
      status: response.status,
      json: (await response.json()) as Record<string, any>,
      cookie: match && match[1] ? `tinyvm_sid=${match[1]}` : undefined,
      setCookie,
    };
  }

  beforeAll(async () => {
    const registered = await authCall('POST', '/api/auth/register', {
      email: `e2e-main-${Date.now()}@example.com`,
      password: 'correct horse battery',
    });
    auth.cookie = registered.cookie ?? '';
  });

  async function registerOther() {
    const other = await authCall('POST', '/api/auth/register', {
      email: `e2e-other-${Date.now()}@example.com`,
      password: 'correct horse battery',
    });
    return other.cookie ?? '';
  }

  it('регистрация, вход, /me и выход', async () => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'correct horse battery';

    const registered = await authCall('POST', '/api/auth/register', { email, password });
    expect(registered.status).toBe(201);
    expect(registered.json.user.email).toBe(email);
    expect(registered.setCookie).toContain('HttpOnly');
    expect(registered.setCookie).toContain('SameSite=Lax');
    expect(registered.cookie).toBeDefined();

    const me = await authCall('GET', '/api/auth/me', undefined, registered.cookie);
    expect(me.status).toBe(200);
    expect(me.json.user.email).toBe(email);

    expect((await authCall('GET', '/api/auth/me')).status).toBe(401);

    const duplicate = await authCall('POST', '/api/auth/register', {
      email: email.toUpperCase(),
      password,
    });
    expect(duplicate.status).toBe(409);

    const wrong = await authCall('POST', '/api/auth/login', { email, password: 'wrong wrong wrong' });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toBe('invalid_credentials');

    const unknown = await authCall('POST', '/api/auth/login', {
      email: 'nobody-here@example.com',
      password,
    });
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);

    const login = await authCall('POST', '/api/auth/login', { email, password });
    expect(login.status).toBe(200);
    expect(login.cookie).toBeDefined();
    expect(login.cookie).not.toBe(registered.cookie);

    expect((await authCall('POST', '/api/auth/logout', undefined, login.cookie)).status).toBe(200);
    expect((await authCall('GET', '/api/auth/me', undefined, login.cookie)).status).toBe(401);
    // Вторая сессия при этом остаётся рабочей.
    expect((await authCall('GET', '/api/auth/me', undefined, registered.cookie)).status).toBe(200);
  });

  it('слабый пароль и некорректный email отклоняются', async () => {
    const short = await authCall('POST', '/api/auth/register', {
      email: `short-${Date.now()}@example.com`,
      password: 'short',
    });
    expect(short.status).toBe(400);

    const bad = await authCall('POST', '/api/auth/register', {
      email: 'not-an-email',
      password: 'correct horse battery',
    });
    expect(bad.status).toBe(400);
  });
  
  it('аноним не может запускать код, сессии и отправки', async () => {
    const requests = [
      ['POST', '/api/run', { source: 'nop' }],
      ['POST', '/api/sessions', { source: 'nop' }],
      ['POST', '/api/tasks/array-sum/submit', { source: 'nop' }],
      ['GET', '/api/me/submissions', undefined],
    ] as const;

    for (const [method, path, body] of requests) {
      expect((await call(method, path, body, '')).status, path).toBe(401);
    }
    expect((await call('GET', '/api/tasks', undefined, '')).status).toBe(200);
  });

  it('сессия принадлежит владельцу, на пользователя не больше двух', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const created = await call('POST', '/api/sessions', { source: 'nop' });
      expect(created.status).toBe(201);
      ids.push(created.json.sessionId as string);
    }

    const third = await call('POST', '/api/sessions', { source: 'nop' });
    expect(third.status).toBe(429);
    expect(third.json.error).toBe('too_many_user_sessions');

    const other = await registerOther();
    expect((await call('GET', `/api/sessions/${ids[0]}/state`, undefined, other)).status).toBe(404);
    expect((await call('DELETE', `/api/sessions/${ids[0]}`, undefined, other)).status).toBe(404);
    expect((await call('GET', `/api/sessions/${ids[0]}/state`)).status).toBe(200);

    for (const id of ids) {
      expect((await call('DELETE', `/api/sessions/${id}`)).status).toBe(200);
    }
  });

  it('история отправок: только свои, с кодом решения', async () => {
    const submitted = await call('POST', '/api/tasks/array-sum/submit', { source: 'mov rax, 1' });
    const id = submitted.json.submissionId as number;

    const list = await call('GET', '/api/me/submissions');
    expect(list.json.submissions.some((item: { id: number }) => item.id === id)).toBe(true);

    const one = await call('GET', `/api/me/submissions/${id}`);
    expect(one.status).toBe(200);
    expect(one.json.submission.source).toBe('mov rax, 1');

    const other = await registerOther();
    expect((await call('GET', `/api/me/submissions/${id}`, undefined, other)).status).toBe(404);
    expect((await call('GET', '/api/me/submissions', undefined, other)).json.submissions).toEqual([]);
  });
});