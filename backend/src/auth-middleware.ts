import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, findUserByToken } from './auth.js';
import type { AuthUser } from './auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function readSessionToken(req: Request): string | undefined {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readSessionToken(req);
  const user = token ? await findUserByToken(token) : null;

  if (!user) {
    res.status(401).json({ status: 'error', error: 'unauthorized' });
    return;
  }

  req.user = user;
  next();
}