import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const MAX_LINE_CHARS = 2 * 1024 * 1024;
const MAX_STDERR_CHARS = 4096;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const CLOSE_GRACE_MS = 2_000;
const U64_MAX = (1n << 64n) - 1n;

export type SessionErrorCode =
  | 'spawn_failed'
  | 'timeout'
  | 'process_exited'
  | 'protocol_violation'
  | 'session_closed';

export type RegisterName =
  | 'rax' | 'rbx' | 'rcx' | 'rdx' | 'rsi' | 'rdi' | 'rbp' | 'rsp'
  | 'r8' | 'r9' | 'r10' | 'r11' | 'r12' | 'r13' | 'r14' | 'r15'
  | 'rip' | 'rflags';

// Проблема с самим процессом. После неё сессия непригодна.
export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface DisassembledInstruction {
  address: string;
  size: number;
  bytes: string;
  mnemonic: string;
  operands: string;
  is_current: boolean;
}

export interface Disassembly {
  code_address: string;
  code_end: string;
  rip: string;
  current_found: boolean;
  complete: boolean;
  instructions: DisassembledInstruction[];
}

export interface SessionResponse {
  status: 'ready' | 'running' | 'finished' | 'limit_exceeded' | 'error';
  instruction_count: number;
  registers: Record<RegisterName, string> | null;
  error: string | null;
  // Дополнительные поля отдельных команд.
  data?: string; // read_memory
  instruction_limit?: number; // set_instruction_limit
  disassembly?: Disassembly; // disassemble
}

export interface SessionOptions {
  mode: 'docker' | 'host';
  binaryPath: string; // для режима host
  image: string; // для режима docker
  commandTimeoutMs?: number;
}

interface Pending {
  resolve: (response: SessionResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// Числа в протоколе передаются строками.
function toUnsignedString(value: bigint | number): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Expected a non-negative safe integer');
    }
    return String(value);
  }
  if (value < 0n || value > U64_MAX) {
    throw new RangeError('Value does not fit in unsigned 64 bits');
  }
  return value.toString();
}

export class TinyVmSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly commandTimeoutMs: number;
  private readonly exited: Promise<void>;
  private readonly containerName: string | null;
  private buffer = '';
  private stderrTail = '';
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private dead: SessionError | null = null;
  private closing = false;

  constructor(options: SessionOptions) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    // Единственное место, где запускается движок.
    if (options.mode === 'docker') {
      this.containerName = `tinyvm-session-${randomUUID()}`;
      this.child = spawn(
        'docker',
        [
          'run', '--rm', '-i',
          '--name', this.containerName,
          '--network', 'none',
          '--read-only',
          '--cap-drop', 'ALL',
          '--security-opt', 'no-new-privileges',
          '--memory', '256m',
          '--memory-swap', '256m',
          '--cpus', '1',
          '--pids-limit', '64',
          options.image,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } else {
      this.containerName = null;
      this.child = spawn(options.binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {}, // не отдаём процессу DATABASE_URL и прочие секреты backend
      });
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    this.exited = new Promise((resolve) => {
      this.child.once('close', () => resolve());
      this.child.once('error', () => resolve());
    });

    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));

    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR_CHARS);
    });

    // Запись в уже закрытый stdin даёт EPIPE. Итог придёт из события 'close'.
    this.child.stdin.on('error', () => {});

    this.child.on('error', (error) => {
      this.fail(new SessionError('spawn_failed', `Cannot start session process: ${error.message}`));
    });

    this.child.on('close', (code, signal) => {
      if (this.pending || !this.closing) {
        this.fail(
          new SessionError(
            'process_exited',
            `Session process exited (code ${code}, signal ${signal}). stderr: ${this.stderrTail.trim()}`,
          ),
        );
      }
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get alive(): boolean {
    return this.dead === null;
  }

  // ---- Команды протокола ----

  load(codeHex: string): Promise<SessionResponse> {
    return this.send({ command: 'load', code: codeHex });
  }

  setRegister(register: string, value: bigint | number): Promise<SessionResponse> {
    return this.send({ command: 'set_register', register, value: toUnsignedString(value) });
  }

  initializeMemory(address: bigint | number, dataHex: string): Promise<SessionResponse> {
    return this.send({
      command: 'initialize_memory',
      address: toUnsignedString(address),
      data: dataHex,
    });
  }

  setInstructionLimit(limit: number): Promise<SessionResponse> {
    return this.send({ command: 'set_instruction_limit', limit: toUnsignedString(limit) });
  }

  step(): Promise<SessionResponse> {
    return this.send({ command: 'step' });
  }

  run(): Promise<SessionResponse> {
    return this.send({ command: 'run' });
  }

  state(): Promise<SessionResponse> {
    return this.send({ command: 'state' });
  }

  disassemble(maxInstructions?: number): Promise<SessionResponse> {
    return this.send(
      maxInstructions === undefined
        ? { command: 'disassemble' }
        : { command: 'disassemble', max_instructions: maxInstructions },
    );
  }

  readMemory(address: bigint | number, size: number): Promise<SessionResponse> {
    return this.send({
      command: 'read_memory',
      address: toUnsignedString(address),
      size: toUnsignedString(size),
    });
  }

  // Завершает сессию. Можно вызывать повторно, ошибок не бросает.
  async close(): Promise<SessionResponse | null> {
    if (this.dead) {
      await this.exited;
      return null;
    }

    this.closing = true;
    let last: SessionResponse | null = null;
    try {
      last = await this.send({ command: 'close' });
    } catch {
      // Процесс уже сломан, ниже его добьём.
    }

    if (!this.dead) {
      this.dead = new SessionError('session_closed', 'Session is closed');
    }
    this.child.stdin.end();
    const killer = setTimeout(() => this.killProcess(), CLOSE_GRACE_MS);
    await this.exited;
    clearTimeout(killer);
    return last;
  }

  // ---- Внутренняя часть ----

  private send(request: Record<string, unknown>): Promise<SessionResponse> {
    const result = this.queue.then(() => this.sendNow(request));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private sendNow(request: Record<string, unknown>): Promise<SessionResponse> {
    if (this.dead) return Promise.reject(this.dead);

    return new Promise<SessionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new SessionError('timeout', `No response within ${this.commandTimeoutMs} ms`),
        );
      }, this.commandTimeoutMs);

      this.pending = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;

    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      newline = this.buffer.indexOf('\n');
    }

    if (this.buffer.length > MAX_LINE_CHARS) {
      this.fail(new SessionError('protocol_violation', 'Response line is too long'));
    }
  }

  private onLine(line: string): void {
    const pending = this.pending;

    if (!pending) {
      // Например, session_timeout: движок сам написал ответ и завершился.
      this.fail(
        new SessionError('process_exited', `Unsolicited output: ${line.slice(0, 200)}`),
      );
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.fail(new SessionError('protocol_violation', 'Response is not valid JSON'));
      return;
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('status' in parsed) ||
      typeof parsed.status !== 'string' ||
      !('error' in parsed)
    ) {
      this.fail(new SessionError('protocol_violation', 'Unexpected response shape'));
      return;
    }

    clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(parsed as SessionResponse);
  }

  // Помечает сессию мёртвой, отклоняет ждущий запрос и убивает процесс. Идемпотентна.
  private fail(error: SessionError): void {
    if (this.dead) return;
    this.dead = error;

    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }

    this.killProcess();;
  }

  // Убивает процесс. В режиме docker kill клиента не останавливает контейнер,
  // поэтому его убиваем по имени.
  private killProcess(): void {
    if (this.containerName) {
      spawn('docker', ['kill', this.containerName], { stdio: 'ignore' }).on('error', () => {});
    }
    this.child.kill('SIGKILL');
  }
}