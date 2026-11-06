import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password', () => {
  it('верный пароль принимается, неверный нет', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('у одного пароля разные хэши (соль), оба проверяются', async () => {
    const a = await hashPassword('same password 123');
    const b = await hashPassword('same password 123');

    expect(a).not.toBe(b);
    expect(await verifyPassword('same password 123', a)).toBe(true);
    expect(await verifyPassword('same password 123', b)).toBe(true);
  });

  it('формат записи содержит параметры и не содержит пароль', async () => {
    const hash = await hashPassword('secret-value-12345');

    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain('secret-value-12345');
  });

  it('повреждённые записи не принимаются и не бросают исключений', async () => {
    for (const stored of ['', 'x', 'scrypt$1$2', 'bcrypt$a$b$c$d$e', 'scrypt$3$8$1$AA==$AA==']) {
      expect(await verifyPassword('anything', stored)).toBe(false);
    }
  });

  it('одинаковые по виду символы в разной записи дают один хэш (NFKC)', async () => {
    const hash = await hashPassword('caf\u00e9-password-1');

    expect(await verifyPassword('cafe\u0301-password-1', hash)).toBe(true);
  });
});