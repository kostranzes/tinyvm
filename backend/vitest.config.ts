import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Тесты не должны касаться настоящей базы: порт 1 заведомо никто не слушает.
    env: { DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test' },
  },
});