import { randomUUID } from 'node:crypto';
import type { TinyVmSession } from './session-client.js';

const MAX_SESSIONS = 8;
const IDLE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 60_000;
const SWEEP_MS = 30_000;

interface Entry {
  session: TinyVmSession;
  createdAt: number;
  lastUsed: number;
}

const sessions = new Map<string, Entry>();
let pending = 0;

// Резервирует место до начала подготовки, чтобы параллельные создания не обошли лимит.
export function reserveSession(): (() => void) | null {
  if (sessions.size + pending >= MAX_SESSIONS) return null;
  pending++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending--;
  };
}

export function addSession(session: TinyVmSession): string {
  const id = randomUUID();
  const now = Date.now();
  sessions.set(id, { session, createdAt: now, lastUsed: now });
  return id;
}

export function getSession(id: string): TinyVmSession | undefined {
  const entry = sessions.get(id);
  if (!entry) return undefined;
  entry.lastUsed = Date.now();
  return entry.session;
}

// Идемпотентна: повторный вызов ничего не делает.
export async function removeSession(id: string): Promise<boolean> {
  const entry = sessions.get(id);
  if (!entry) return false;
  sessions.delete(id);
  await entry.session.close();
  return true;
}

export async function closeAllSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => removeSession(id)));
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (!entry.session.alive || now - entry.lastUsed > IDLE_MS || now - entry.createdAt > MAX_AGE_MS) {
      removeSession(id).catch((error) => console.error('Failed to close expired session:', error));
    }
  }
}, SWEEP_MS);
sweeper.unref(); // таймер не должен мешать процессу завершиться