const MAX_CONCURRENT_RUNS = 4;

let active = 0;

// Возвращает функцию освобождения слота или null, если все слоты заняты.
export function tryAcquire(): (() => void) | null {
  if (active >= MAX_CONCURRENT_RUNS) return null;
  active++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
  };
}