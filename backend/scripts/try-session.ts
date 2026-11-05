import { config } from '../src/config.js';
import { TinyVmSession, SessionError } from '../src/session-client.js';

const binaryPath = config.sessionBin;

// 1. Программа: mov rax, rdi; add rax, rsi. Ждём rax = 5.
const s = new TinyVmSession({ binaryPath });
console.log('load:', await s.load('4889f84801f0'));
await s.setRegister('rdi', 2);
await s.setRegister('rsi', 3);
console.log('run:', await s.run());
console.log('state:', await s.state());

// 2. Ошибка протокола возвращается как ответ, а не исключение.
console.log('second load:', (await s.load('90')).error); // load_failed

// 3. После close() команды отклоняются.
await s.close();
try {
  await s.state();
} catch (e) {
  console.log('after close:', e instanceof SessionError ? e.code : e); // session_closed
}

// 4. Падение процесса снаружи.
const s2 = new TinyVmSession({ binaryPath });
await s2.state();
process.kill(s2.pid!, 'SIGKILL');
try {
  await s2.state();
} catch (e) {
  console.log('after kill:', e instanceof SessionError ? e.code : e); // process_exited
}
await s2.close();

// 5. Таймаут: 1 мс почти наверняка меньше, чем запуск процесса.
const s3 = new TinyVmSession({ binaryPath, commandTimeoutMs: 1 });
try {
  await s3.state();
} catch (e) {
  console.log('timeout:', e instanceof SessionError ? e.code : e); // timeout
}
await s3.close();

// 6. Несуществующий бинарник.
const s4 = new TinyVmSession({ binaryPath: '/nonexistent/tinyvm-session' });
try {
  await s4.state();
} catch (e) {
  console.log('bad path:', e instanceof SessionError ? e.code : e); // spawn_failed
}
await s4.close();