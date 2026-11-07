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
    default:
      return `Ошибка сервера (${error.status}: ${error.code}).`
  }
}