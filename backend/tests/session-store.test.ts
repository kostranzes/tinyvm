import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TinyVmSession } from '../src/session-client.js';

type Store = typeof import('../src/session-store.js');

let store: Store;

function fake(alive = true) {
  const close = vi.fn(async () => null);
  const session = { alive, close } as unknown as TinyVmSession;
  return { session, close };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  store = await import('../src/session-store.js');
});

afterEach(async () => {
  await store.closeAllSessions();
  vi.useRealTimers();
});

describe('session-store: лимиты', () => {
  it('всего не больше 8 сессий', () => {
    for (let user = 1; user <= 4; user++) {
      for (let i = 0; i < 2; i++) expect(store.reserveSession(user).ok).toBe(true);
    }

    expect(store.reserveSession(5)).toMatchObject({ ok: false, reason: 'server_full' });
  });

  it('на пользователя не больше 2, резервы и готовые сессии считаются вместе', () => {
    store.addSession(fake().session, 1);

    expect(store.reserveSession(1).ok).toBe(true);
    expect(store.reserveSession(1)).toMatchObject({ ok: false, reason: 'user_limit' });
    expect(store.reserveSession(2).ok).toBe(true);
  });

  it('освобождённый резерв можно занять снова, повторное освобождение безопасно', () => {
    const first = store.reserveSession(1);
    const second = store.reserveSession(1);
    if (!first.ok || !second.ok) throw new Error('expected reservations');

    first.release();
    first.release();

    expect(store.reserveSession(1).ok).toBe(true);
    expect(store.reserveSession(1)).toMatchObject({ ok: false, reason: 'user_limit' });
  });
});

describe('session-store: владелец', () => {
  it('чужая сессия недоступна и не удаляется', async () => {
    const { session, close } = fake();
    const id = store.addSession(session, 1);

    expect(store.getSession(id, 2)).toBeUndefined();
    expect(await store.removeOwnedSession(id, 2)).toBe(false);
    expect(close).not.toHaveBeenCalled();

    expect(store.getSession(id, 1)).toBe(session);
    expect(await store.removeOwnedSession(id, 1)).toBe(true);
    expect(await store.removeOwnedSession(id, 1)).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closeAllSessions закрывает все', async () => {
    const a = fake();
    const b = fake();
    store.addSession(a.session, 1);
    store.addSession(b.session, 2);

    await store.closeAllSessions();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });
});

describe('session-store: очистка', () => {
  it('закрывает сессию, которой не пользуются больше 5 минут', async () => {
    const { session, close } = fake();
    const id = store.addSession(session, 1);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(store.getSession(id, 1)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('обращения продлевают жизнь, но не дольше 30 минут', async () => {
    const { session, close } = fake();
    const id = store.addSession(session, 1);

    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      store.getSession(id, 1);
    }

    expect(store.getSession(id, 1)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('убирает сессию с умершим процессом в течение 30 секунд', async () => {
    const { session, close } = fake(false);
    const id = store.addSession(session, 1);

    await vi.advanceTimersByTimeAsync(31_000);

    expect(store.getSession(id, 1)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});