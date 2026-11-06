import { z } from 'zod';
import { assemble } from './assemble.js';
import type { AssembleError } from './assemble.js';
import { config } from './config.js';
import { SessionError, TinyVmSession } from './session-client.js';
import type { SessionResponse } from './session-client.js';

const U64_MAX = (1n << 64n) - 1n;

// Число строкой, как в протоколе движка: десятичное или 0x-hex, в пределах 64 бит.
export const u64String = z
  .string()
  .regex(/^([0-9]+|0[xX][0-9a-fA-F]+)$/, 'expected decimal or 0x-hex number')
  .refine((s) => {
    try {
      return BigInt(s) <= U64_MAX;
    } catch {
      return false;
    }
  }, 'must fit in unsigned 64 bits');

// Регистры, которые протокол разрешает записывать (без rip, rsp, rflags).
const WRITABLE_REGISTERS = [
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
] as const;

export const runRequestSchema = z.object({
  source: z.string(),
  registers: z.partialRecord(z.enum(WRITABLE_REGISTERS), u64String).default({}),
  memory: z
    .array(
      z.object({
        address: u64String,
        // Целое число байт в hex, до 65536 байт.
        data: z
          .string()
          .regex(/^([0-9a-fA-F]{2})+$/, 'expected hex bytes')
          .max(131072),
      }),
    )
    .max(16)
    .default([]),
  instructionLimit: z.number().int().min(1).max(1_000_000).optional(),
  readMemory: z
    .array(
      z.object({
        address: u64String,
        size: z.number().int().min(1).max(4096),
      }),
    )
    .max(16)
    .default([]),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export interface MemoryReadResult {
  address: string;
  size: number;
  data: string | null;
  error: string | null;
}

export type RunOutcome =
  | { kind: 'assemble_failed'; error: AssembleError; message: string }
  | { kind: 'setup_failed'; stage: string; error: string }
  | { kind: 'engine_unavailable'; code: string }
  | { kind: 'ok'; codeSize: number; result: SessionResponse; memory: MemoryReadResult[] };

// Движок отверг настройку (регистр, память, лимит).
class SetupError extends Error {
  readonly stage: string;
  readonly code: string;

  constructor(stage: string, code: string) {
    super(`${stage}: ${code}`);
    this.name = 'SetupError';
    this.stage = stage;
    this.code = code;
  }
}

function expectOk(stage: string, response: SessionResponse): void {
  if (response.error !== null) {
    throw new SetupError(stage, response.error);
  }
}

export type PrepareOutcome =
  | { kind: 'assemble_failed'; error: AssembleError; message: string }
  | { kind: 'setup_failed'; stage: string; error: string }
  | { kind: 'engine_unavailable'; code: string }
  | {
      kind: 'prepared';
      session: TinyVmSession;
      codeSize: number;
      state: SessionResponse;
      disassembly: SessionResponse;
    };

// Запускает сессию из готовых байтов и настраивает её, но не выполняет.
// При успехе сессию закрывает вызывающий, при любой ошибке она закрыта здесь.
export async function prepareFromCode(
  code: Buffer,
  request: Omit<RunRequest, 'source' | 'readMemory'>,
): Promise<PrepareOutcome> {
  const session = new TinyVmSession({ binaryPath: config.sessionBin });

  try {
    expectOk('load', await session.load(code.toString('hex')));

    for (const [name, value] of Object.entries(request.registers)) {
      if (value === undefined) continue;
      expectOk(`set_register ${name}`, await session.setRegister(name, BigInt(value)));
    }

    for (const item of request.memory) {
      expectOk(
        `initialize_memory ${item.address}`,
        await session.initializeMemory(BigInt(item.address), item.data),
      );
    }

    if (request.instructionLimit !== undefined) {
      expectOk(
        'set_instruction_limit',
        await session.setInstructionLimit(request.instructionLimit),
      );
    }

    const state = await session.state();
    expectOk('state', state);
    const disassembly = await session.disassemble();
    expectOk('disassemble', disassembly);

    return { kind: 'prepared', session, codeSize: code.length, state, disassembly };
  } catch (error) {
    await session.close();
    if (error instanceof SetupError) {
      return { kind: 'setup_failed', stage: error.stage, error: error.code };
    }
    if (error instanceof SessionError) {
      console.error('Session failure:', error.code, error.message);
      return { kind: 'engine_unavailable', code: error.code };
    }
    throw error;
  }
}

export async function prepareSession(
  request: Omit<RunRequest, 'readMemory'>,
): Promise<PrepareOutcome> {
  const assembled = await assemble(request.source);
  if (!assembled.ok) {
    return { kind: 'assemble_failed', error: assembled.error, message: assembled.message };
  }
  return prepareFromCode(assembled.code, request);
}

export async function runProgram(request: RunRequest): Promise<RunOutcome> {
  const prepared = await prepareSession(request);
  if (prepared.kind !== 'prepared') return prepared;

  const { session } = prepared;

  try {
    // Ошибка выполнения (например, instruction_limit_exceeded) здесь не исключение:
    // это результат программы пользователя, он возвращается как есть.
    const result = await session.run();

    const memory: MemoryReadResult[] = [];
    for (const item of request.readMemory) {
      const response = await session.readMemory(BigInt(item.address), item.size);
      memory.push({
        address: item.address,
        size: item.size,
        data: response.error === null ? (response.data ?? null) : null,
        error: response.error,
      });
    }

    return { kind: 'ok', codeSize: prepared.codeSize, result, memory };
  } catch (error) {
    if (error instanceof SessionError) {
      console.error('Session failure:', error.code, error.message);
      return { kind: 'engine_unavailable', code: error.code };
    }
    throw error;
  } finally {
    await session.close();
  }
}