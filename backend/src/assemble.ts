import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const IMAGE = 'tinyvm-nasm';
const MAX_SOURCE_BYTES = 16 * 1024;
const MAX_CODE_BYTES = 4096;
const TIMEOUT_MS = 5000;
const MAX_STDERR_BYTES = 8 * 1024;

// Директивы, которые читают файлы или подключают внешние модули.
// Проверка нарочно грубая: лучше лишний отказ, чем пропуск.
const FORBIDDEN = /%\s*(include|pathsearch|depend|use)\b|\bincbin\b/i;

export type AssembleResult =
  | { ok: true; code: Buffer }
  | { ok: false; error: AssembleError; message: string };

export type AssembleError =
  | 'source_too_large'
  | 'forbidden_directive'
  | 'assembly_failed'
  | 'empty_output'
  | 'code_too_large'
  | 'timeout'
  | 'internal_error';

function killContainer(name: string): void {
  spawn('docker', ['kill', name], { stdio: 'ignore' }).on('error', () => {});
}

function cleanMessage(stderr: string): string {
  // Внутренний путь пользователю не нужен. Строка "bits 64" добавлена перед
  // исходником, поэтому вычитаем одну строку, чтобы номера совпадали с кодом пользователя.
  return stderr
    .replace(/\/work\/in\.asm:(\d+):/g, (_match, n: string) => `line ${Math.max(Number(n) - 1, 1)}:`)
    .trim();
}

export function assemble(source: string): Promise<AssembleResult> {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    return Promise.resolve({
      ok: false,
      error: 'source_too_large',
      message: `Source is larger than ${MAX_SOURCE_BYTES} bytes`,
    });
  }

  if (FORBIDDEN.test(source)) {
    return Promise.resolve({
      ok: false,
      error: 'forbidden_directive',
      message: 'Directives %include, %pathsearch, %depend, %use and incbin are not allowed',
    });
  }

  // "bits 64" отдельной строкой: в NASM точка с запятой начинает комментарий.
  // Сдвиг номеров строк компенсирует cleanMessage.
  const fullSource = `bits 64\n${source}`;

  const name = `tinyvm-nasm-${randomUUID()}`;

  return new Promise((resolve) => {
    const child = spawn(
      'docker',
      [
        'run', '--rm', '-i',
        '--name', name,
        '--network', 'none',
        '--read-only',
        '--cap-drop', 'ALL',
        '--memory', '128m',
        '--pids-limit', '64',
        '--tmpfs', '/work:rw,noexec,nosuid,size=1m,mode=1777',
        IMAGE,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const stdout: Buffer[] = [];
    let stdoutSize = 0;
    let stderr = '';
    let timedOut = false;
    let tooLarge = false;
    let settled = false;

    const finish = (result: AssembleResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killContainer(name);
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_CODE_BYTES) {
        tooLarge = true;
        killContainer(name);
        child.kill('SIGKILL');
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (error) => {
      console.error('Failed to start docker:', error);
      finish({ ok: false, error: 'internal_error', message: 'Assembler is unavailable' });
    });

    child.on('close', (exitCode) => {
      if (timedOut) {
        finish({ ok: false, error: 'timeout', message: 'Assembly timed out' });
      } else if (tooLarge) {
        finish({
          ok: false,
          error: 'code_too_large',
          message: `Machine code is larger than ${MAX_CODE_BYTES} bytes`,
        });
      } else if (exitCode === 0) {
        const code = Buffer.concat(stdout);
        if (code.length === 0) {
          finish({ ok: false, error: 'empty_output', message: 'Program produced no machine code' });
        } else {
          finish({ ok: true, code });
        }
      } else if (exitCode === 1 && stderr.includes('error')) {
        finish({ ok: false, error: 'assembly_failed', message: cleanMessage(stderr) });
      } else {
        console.error('Assembler failed, exit code', exitCode, stderr);
        finish({ ok: false, error: 'internal_error', message: 'Assembler is unavailable' });
      }
    });

    child.stdin.on('error', () => {
      // Контейнер мог завершиться раньше, чем мы дописали stdin. Результат придёт из 'close'.
    });
    child.stdin.end(fullSource);
  });
}