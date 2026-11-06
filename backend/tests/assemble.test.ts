import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assemble.js';

// Все случаи здесь отклоняются до запуска Docker.
describe('assemble: отказ до запуска контейнера', () => {
  it.each([
    '%include "/etc/passwd"',
    '%  include "x"',
    '%INCLUDE "x"',
    'incbin "x"',
    'INCBIN "x"',
    '%pathsearch p "x"',
    '%depend "x"',
    '%use smartalign',
  ])('отклоняет %s', async (source) => {
    const result = await assemble(source);
    expect(result).toMatchObject({ ok: false, error: 'forbidden_directive' });
  });

  it('проверка грубая: директива в комментарии тоже отклоняется', async () => {
    const result = await assemble('nop ; incbin');
    expect(result).toMatchObject({ ok: false, error: 'forbidden_directive' });
  });

  it('отклоняет исходник больше 16 КиБ', async () => {
    const result = await assemble('a'.repeat(16 * 1024 + 1));
    expect(result).toMatchObject({ ok: false, error: 'source_too_large' });
  });

  it('размер считается в байтах, а не в символах', async () => {
    // 9000 символов, но 18000 байт в UTF-8.
    const result = await assemble('я'.repeat(9000));
    expect(result).toMatchObject({ ok: false, error: 'source_too_large' });
  });
});