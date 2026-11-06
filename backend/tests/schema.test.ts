import { describe, expect, it } from 'vitest';
import { runRequestSchema } from '../src/run-program.js';

const ok = (value: unknown): boolean => runRequestSchema.safeParse(value).success;

describe('runRequestSchema', () => {
  it('минимальный запрос получает значения по умолчанию', () => {
    const parsed = runRequestSchema.parse({ source: 'nop' });
    expect(parsed.registers).toEqual({});
    expect(parsed.memory).toEqual([]);
    expect(parsed.readMemory).toEqual([]);
    expect(parsed.instructionLimit).toBeUndefined();
  });

  it('source обязателен', () => {
    expect(ok({})).toBe(false);
  });

  it.each(['0', '10', '010', '0x110000', '0XfF', '18446744073709551615'])(
    'принимает число %s',
    (value) => {
      expect(ok({ source: 'nop', registers: { rax: value } })).toBe(true);
    },
  );

  it.each([
    '',
    '0x',
    '-1',
    '+1',
    ' 5',
    '5 ',
    '1_0',
    '0xg',
    '1e3',
    '18446744073709551616',
    '0x10000000000000000',
  ])('отклоняет число %j', (value) => {
    expect(ok({ source: 'nop', registers: { rax: value } })).toBe(false);
  });

  it('число в JSON вместо строки отклоняется', () => {
    expect(ok({ source: 'nop', registers: { rax: 5 } })).toBe(false);
  });

  it.each(['rsp', 'rip', 'rflags', 'eax', 'RAX'])(
    'регистр %s записывать нельзя',
    (name) => {
      expect(ok({ source: 'nop', registers: { [name]: '1' } })).toBe(false);
    },
  );

  it.each(['rax', 'rbp', 'r8', 'r15'])('регистр %s записывать можно', (name) => {
    expect(ok({ source: 'nop', registers: { [name]: '1' } })).toBe(true);
  });

  it('данные памяти: целое число байт в hex', () => {
    const memory = (data: string) => ({
      source: 'nop',
      memory: [{ address: '0x110000', data }],
    });

    expect(ok(memory('0a00'))).toBe(true);
    expect(ok(memory('0A0b'))).toBe(true);
    expect(ok(memory(''))).toBe(false);
    expect(ok(memory('abc'))).toBe(false); // нечётное число символов
    expect(ok(memory('zz'))).toBe(false);
    expect(ok(memory('00'.repeat(65536)))).toBe(true);
    expect(ok(memory('00'.repeat(65537)))).toBe(false);
  });

  it('границы instructionLimit', () => {
    const limit = (instructionLimit: number) => ({ source: 'nop', instructionLimit });

    expect(ok(limit(1))).toBe(true);
    expect(ok(limit(1_000_000))).toBe(true);
    expect(ok(limit(0))).toBe(false);
    expect(ok(limit(1_000_001))).toBe(false);
    expect(ok(limit(1.5))).toBe(false);
  });

  it('границы readMemory', () => {
    const read = (size: number) => ({
      source: 'nop',
      readMemory: [{ address: '0x110000', size }],
    });

    expect(ok(read(1))).toBe(true);
    expect(ok(read(4096))).toBe(true);
    expect(ok(read(0))).toBe(false);
    expect(ok(read(4097))).toBe(false);
  });

  it('не больше 16 областей памяти за запрос', () => {
    const entry = { address: '0x110000', data: '00' };

    expect(ok({ source: 'nop', memory: Array(16).fill(entry) })).toBe(true);
    expect(ok({ source: 'nop', memory: Array(17).fill(entry) })).toBe(false);
  });
});