import { describe, expect, it } from 'vitest';
import { compareRegisters } from '../src/judge.js';

describe('compareRegisters', () => {
  it('одно и то же число в разной записи совпадает', () => {
    expect(compareRegisters({ rax: '10' }, { rax: '0x000000000000000a' })).toEqual([]);
    expect(compareRegisters({ rax: '0xa' }, { rax: '0x000000000000000a' })).toEqual([]);
  });

  it('расхождение описывается в едином формате', () => {
    expect(compareRegisters({ rax: '0xa' }, { rax: '0x0000000000000001' })).toEqual([
      { what: 'rax', expected: '0x000000000000000a', actual: '0x0000000000000001' },
    ]);
  });

  it('регистры, которых нет в expected, не проверяются', () => {
    expect(
      compareRegisters({ rax: '1' }, { rax: '0x1', rbx: '0xdead', rcx: '0xbeef' }),
    ).toEqual([]);
  });

  it('регистр без значения считается расхождением', () => {
    expect(compareRegisters({ rax: '1' }, {})).toEqual([
      { what: 'rax', expected: '0x0000000000000001', actual: 'unavailable' },
    ]);
    expect(compareRegisters({ rax: '1' }, null)).toHaveLength(1);
  });

  it('полные 64 бита сравниваются без потери точности', () => {
    const max = '0xffffffffffffffff';
    expect(compareRegisters({ rax: max }, { rax: max })).toEqual([]);
    expect(compareRegisters({ rax: max }, { rax: '0xfffffffffffffffe' })).toHaveLength(1);
  });

  it('пустой expected ничего не проверяет', () => {
    expect(compareRegisters({}, { rax: '0x1' })).toEqual([]);
  });
});