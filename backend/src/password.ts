import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  params: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC: разные записи одного и того же символа дают один хэш.
    scrypt(password.normalize('NFKC'), salt, keyLength, params, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, DEFAULT_PARAMS);
  const { N, r, p } = DEFAULT_PARAMS;

  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltText, keyText] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(keyText, 'base64');

  if (expected.length === 0 || salt.length === 0) return false;

  try {
    const actual = await derive(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    // Некорректные параметры в записи.
    return false;
  }
}

// Хэш несуществующего пользователя: проверка против него занимает столько же времени,
// сколько настоящая, поэтому по времени ответа нельзя узнать, есть ли такой email.
let dummyHash: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('tinyvm-dummy-password');
  return dummyHash;
}