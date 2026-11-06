import { afterEach, describe, expect, it } from 'vitest';
import { tryAcquire } from '../src/limiter.js';

const held: Array<() => void> = [];

function take(): (() => void) | null {
  const release = tryAcquire();
  if (release) held.push(release);
  return release;
}

// Освобождение идемпотентно, поэтому повторный вызов безопасен.
afterEach(() => {
  while (held.length > 0) held.pop()!();
});

describe('limiter', () => {
  it('пускает 4 одновременных запуска, пятому отказывает', () => {
    for (let i = 0; i < 4; i++) expect(take()).not.toBeNull();
    expect(tryAcquire()).toBeNull();
  });

  it('освобождённый слот можно занять снова', () => {
    const slots = [take(), take(), take(), take()];
    expect(tryAcquire()).toBeNull();

    slots[0]!();
    expect(take()).not.toBeNull();
  });

  it('повторное освобождение не уводит счётчик в минус', () => {
    const slots = [take(), take(), take(), take()];

    slots[0]!();
    slots[0]!();

    expect(take()).not.toBeNull(); // один свободный слот
    expect(tryAcquire()).toBeNull(); // а не два
  });
});