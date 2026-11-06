import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TinyVmSession } from '../src/session-client.js';

type Store = typeof import('../src/session-store.js');

let store: Store;

function fake(alive = true) {
  const close = vi.fn(async () => null);
  const session = { alive, close } as unknown as TinyVmSession;
  return { session, close };
}

// Модуль хранит состояние и сам запускает таймер очистки, поэтому каждый тест
// получает его заново и работает на фальшивых часах.
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  store = await import('../src/session-store.js');
});

afterEach(async () => {
  await store.closeAllSessions();
  vi.useRealTimers();
});

describe('session-store: лимит', () => {
  it('резервирует не больше 8 мест', () => {
    const held = Array.from({ length: 8 }, () => store.reserveSession());

    expect(held.every((release) => release !== null)).toBe(true);
    expect(store.reserveSession()).toBeNull();

    held[0]!();
    expect(store.reserveSession()).not.toBeNull();
  });

  it('готовые сессии и резервы считаются вместе', () => {
    for (let i = 0; i < 7; i++) store.addSession(fake().session);

    expect(store.reserveSession()).not.toBeNull();
    expect(store.reserveSession()).toBeNull();
  });
});

describe('session-store: хранение', () => {
  it('отдаёт сессию по id и закрывает её при удалении ровно один раз', async () => {
    const { session, close } = fake();
    const id = store.addSession(session);

    expect(store.getSession(id)).toBe(session);
    expect(await store.removeSession(id)).toBe(true);
    expect(await store.removeSession(id)).toBe(false);
    expect(store.getSession(id)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closeAllSessions закрывает все', async () => {
    const a = fake();
    const b = fake();
    store.addSession(a.session);
    store.addSession(b.session);

    await store.closeAllSessions();

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
  });
});

describe('session-store: очистка', () => {
  it('закрывает сессию, которой не пользуются больше 5 минут', async () => {
    const { session, close } = fake();
    const id = store.addSession(session);

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(store.getSession(id)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('обращения продлевают жизнь, но не дольше 30 минут', async () => {
    const { session, close } = fake();
    const id = store.addSession(session);

    // Раз в 4 минуты обращаемся к сессии: простоя нет, но возраст растёт.
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      store.getSession(id);
    }

    expect(store.getSession(id)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('убирает сессию с умершим процессом в течение 30 секунд', async () => {
    const { session, close } = fake(false);
    const id = store.addSession(session);

    await vi.advanceTimersByTimeAsync(31_000);

    expect(store.getSession(id)).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});