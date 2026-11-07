import { randomUUID } from 'node:crypto';
import type { TinyVmSession } from './session-client.js';

const MAX_SESSIONS = 8;
const MAX_SESSIONS_PER_USER = 2;
const IDLE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 60_000;
const SWEEP_MS = 30_000;

interface Entry {
  session: TinyVmSession;
  userId: number;
  createdAt: number;
  lastUsed: number;
}

const sessions = new Map<string, Entry>();
const pendingByUser = new Map<number, number>();
let pending = 0;

export type Reservation =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'server_full' | 'user_limit' };

function sessionsOf(userId: number): number {
  let count = pendingByUser.get(userId) ?? 0;
  for (const entry of sessions.values()) {
    if (entry.userId === userId) count++;
  }
  return count;
}

// Резервирует место до начала подготовки, чтобы параллельные создания не обошли лимиты.
export function reserveSession(userId: number): Reservation {
  if (sessions.size + pending >= MAX_SESSIONS) return { ok: false, reason: 'server_full' };
  if (sessionsOf(userId) >= MAX_SESSIONS_PER_USER) return { ok: false, reason: 'user_limit' };

  pending++;
  pendingByUser.set(userId, (pendingByUser.get(userId) ?? 0) + 1);

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      pending--;
      const left = (pendingByUser.get(userId) ?? 1) - 1;
      if (left <= 0) pendingByUser.delete(userId);
      else pendingByUser.set(userId, left);
    },
  };
}

export function addSession(session: TinyVmSession, userId: number): string {
  const id = randomUUID();
  const now = Date.now();
  sessions.set(id, { session, userId, createdAt: now, lastUsed: now });
  return id;
}

// Чужая сессия неотличима от несуществующей.
export function getSession(id: string, userId: number): TinyVmSession | undefined {
  const entry = sessions.get(id);
  if (!entry || entry.userId !== userId) return undefined;
  entry.lastUsed = Date.now();
  return entry.session;
}

// Без проверки владельца: для очистки и завершения сервера.
export async function removeSession(id: string): Promise<boolean> {
  const entry = sessions.get(id);
  if (!entry) return false;
  sessions.delete(id);
  await entry.session.close();
  return true;
}

export async function removeOwnedSession(id: string, userId: number): Promise<boolean> {
  if (sessions.get(id)?.userId !== userId) return false;
  return removeSession(id);
}

export async function closeAllSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => removeSession(id)));
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (
      !entry.session.alive ||
      now - entry.lastUsed > IDLE_MS ||
      now - entry.createdAt > MAX_AGE_MS
    ) {
      removeSession(id).catch((error) => console.error('Failed to close expired session:', error));
    }
  }
}, SWEEP_MS);
sweeper.unref();