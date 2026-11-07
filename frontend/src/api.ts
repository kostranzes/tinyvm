// Тонкая обёртка над fetch для backend TinyVM.
// Справочник по API: backend/README.md.

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export interface User {
  id: number | string
  email: string
}

export interface TaskSummary {
  slug: string
  title: string
  difficulty: string
}

export interface VisibleTest {
  position: number
  // Формат см. backend/README.md, раздел Tasks. Пока показываем как JSON.
  input: unknown
  expected: unknown
}

export interface Task {
  title: string
  description: string
  starterCode: string
  instructionLimit: number
  difficulty: string
  visibleTests: VisibleTest[]
  hiddenTestCount: number
}

export type Verdict =
  | 'accepted'
  | 'wrong_answer'
  | 'runtime_error'
  | 'limit_exceeded'
  | 'assembly_error'

export interface Mismatch {
  what: string
  expected: unknown
  actual: unknown
}

export interface SubmitResult {
  status: string
  submissionId: number
  verdict: Verdict
  passed?: number
  total?: number
  instructionCount?: number
  message?: string
  failedTest?: {
    position: number
    hidden: boolean
    mismatches?: Mismatch[]
    engineError?: string
  }
}

export interface RunRequest {
  source: string
  registers?: Record<string, string>
  memory?: { address: string; data: string }[]
  instructionLimit?: number
  readMemory?: { address: string; size: number }[]
}

// Состояние движка. Тот же формат будет у отладочных сессий.
export interface EngineState {
  status: string
  instructionCount: number
  registers: Record<string, string>
  error: unknown
}

export interface MemoryRead {
  address?: string
  size?: number
  data?: string
  error?: unknown
}

export interface RunResult {
  codeSize: number
  result: EngineState
  memory?: MemoryRead[]
}

// Ошибка запроса. status = 0 означает, что до сервера не достучались.
export class ApiError extends Error {
  status: number
  code: string
  body: unknown

  constructor(status: number, code: string, body?: unknown) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network_error')
  }

  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // тело не JSON или пустое
  }

  const code =
    typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'http_error'

  if (!response.ok) {
    throw new ApiError(response.status, code, data)
  }
  return data as T
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<{ status: string }>('POST', '/api/auth/logout'),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  tasks: () => request<{ tasks: TaskSummary[] }>('GET', '/api/tasks'),
  task: (slug: string) =>
    request<{ task: Task }>('GET', `/api/tasks/${encodeURIComponent(slug)}`).then((r) => r.task),
  submit: (slug: string, source: string) =>
    request<SubmitResult>('POST', `/api/tasks/${encodeURIComponent(slug)}/submit`, { source }),
  run: (req: RunRequest) => request<RunResult>('POST', '/api/run', req),
}

// Текст ошибки для пользователя.
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Неизвестная ошибка'
  switch (error.code) {
    case 'network_error':
      return 'Не удалось связаться с сервером. Он запущен?'
    case 'invalid_request':
      return 'Проверьте email и пароль (пароль: от 10 до 128 символов).'
    case 'email_taken':
      return 'Этот email уже зарегистрирован.'
    case 'invalid_credentials':
      return 'Неверный email или пароль.'
    case 'rate_limited':
      return 'Слишком много попыток. Подождите минуту.'
    case 'forbidden_origin':
      return 'Сервер отклонил запрос из-за Origin. Открывайте сайт как http://localhost:5173.'
    case 'task_not_found':
      return 'Такой задачи нет.'
    case 'unauthorized':
      return 'Нужно войти.'
    case 'busy':
      return 'Сервер занят проверкой других решений. Повторите через несколько секунд.'
    case 'engine_unavailable':
      return 'Движок недоступен (проблема на сервере). Попробуйте позже.'
    case 'assembly_failed':
      return 'Не удалось собрать программу.'
    case 'forbidden_directive':
      return 'В коде есть запрещённая директива (%include, incbin и подобные).'
    case 'source_too_large':
      return 'Исходный код слишком большой.'
    case 'code_too_large':
      return 'Машинный код больше 4096 байт.'
    case 'empty_output':
      return 'Программа после сборки пустая.'
    case 'setup_failed':
      return 'Движок отклонил начальные данные.'
    default:
      return `Ошибка сервера (${error.status}: ${error.code}).`
  }
}