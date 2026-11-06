import { z } from 'zod';
import { assemble } from './assemble.js';
import { prepareFromCode, runRequestSchema, u64String } from './run-program.js';
import { SessionError } from './session-client.js';

export type Verdict =
  | 'accepted'
  | 'wrong_answer'
  | 'runtime_error'
  | 'limit_exceeded'
  | 'assembly_error';

export type TestRow = {
  position: number;
  is_hidden: boolean;
  input: unknown;
  expected: unknown;
};

export interface Mismatch {
  what: string;
  expected: string;
  actual: string;
}

export interface FailedTest {
  position: number;
  hidden: boolean;
  engineError?: string;
  mismatches?: Mismatch[];
}

export type JudgeOutcome =
  | { kind: 'unavailable' }
  | {
      kind: 'verdict';
      verdict: Verdict;
      passed: number;
      total: number;
      instructionCount: number;
      message?: string;
      failed?: FailedTest;
    };

// Данные тестов лежат в базе, но форму всё равно проверяем: битая запись не должна
// превращаться в странный вердикт.
const testInputSchema = runRequestSchema.pick({ registers: true, memory: true });

const testExpectedSchema = z.object({
  registers: z.record(z.string(), u64String).default({}),
  memory: z
    .array(
      z.object({
        address: u64String,
        data: z
          .string()
          .regex(/^([0-9a-fA-F]{2})+$/)
          .max(8192), // до 4096 байт, как максимум чтения памяти
      }),
    )
    .default([]),
});

export async function judgeSubmission(
  source: string,
  instructionLimit: number,
  tests: TestRow[],
): Promise<JudgeOutcome> {
  const total = tests.length;

  const assembled = await assemble(source);
  if (!assembled.ok) {
    if (assembled.error === 'internal_error') return { kind: 'unavailable' };
    return {
      kind: 'verdict',
      verdict: 'assembly_error',
      passed: 0,
      total,
      instructionCount: 0,
      message: assembled.message,
    };
  }

  let passed = 0;
  let maxInstructions = 0;

  for (const test of tests) {
    const input = testInputSchema.parse(test.input);
    const expected = testExpectedSchema.parse(test.expected);

    const prepared = await prepareFromCode(assembled.code, { ...input, instructionLimit });
    if (prepared.kind !== 'prepared') {
      // Ошибка настройки на данных самого задания это наша ошибка, не пользователя.
      console.error('Judge could not prepare a test:', test.position, prepared);
      return { kind: 'unavailable' };
    }

    const { session } = prepared;
    try {
      const result = await session.run();
      maxInstructions = Math.max(maxInstructions, result.instruction_count);

      const base = { passed, total, instructionCount: maxInstructions };
      const where = { position: test.position, hidden: test.is_hidden };

      if (result.error === 'instruction_limit_exceeded') {
        return { kind: 'verdict', verdict: 'limit_exceeded', ...base, failed: where };
      }
      if (result.error !== null || result.status !== 'finished') {
        return {
          kind: 'verdict',
          verdict: 'runtime_error',
          ...base,
          failed: { ...where, engineError: result.error ?? result.status },
        };
      }

      const registers = result.registers as Record<string, string> | null;
      const mismatches: Mismatch[] = [];

      for (const [name, value] of Object.entries(expected.registers)) {
        const actual = registers?.[name];
        if (actual === undefined || BigInt(actual) !== BigInt(value)) {
          mismatches.push({
            what: name,
            expected: `0x${BigInt(value).toString(16).padStart(16, '0')}`,
            actual: actual ?? 'unavailable',
          });
        }
      }

      for (const item of expected.memory) {
        const size = item.data.length / 2;
        const response = await session.readMemory(BigInt(item.address), size);
        const actual = response.error === null ? (response.data ?? '') : `error: ${response.error}`;
        if (response.error !== null || actual.toLowerCase() !== item.data.toLowerCase()) {
          mismatches.push({
            what: `memory ${item.address} (${size} bytes)`,
            expected: item.data.toLowerCase(),
            actual,
          });
        }
      }

      if (mismatches.length > 0) {
        return { kind: 'verdict', verdict: 'wrong_answer', ...base, failed: { ...where, mismatches } };
      }

      passed++;
    } catch (error) {
      if (error instanceof SessionError) {
        console.error('Session failure while judging:', error.code, error.message);
        return { kind: 'unavailable' };
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  return {
    kind: 'verdict',
    verdict: 'accepted',
    passed,
    total,
    instructionCount: maxInstructions,
  };
}