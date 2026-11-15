import type { Verdict } from '../api'

export const VERDICT_TEXT: Record<Verdict, string> = {
  accepted: 'Принято',
  wrong_answer: 'Неверный ответ',
  runtime_error: 'Ошибка выполнения',
  limit_exceeded: 'Превышен лимит инструкций',
  assembly_error: 'Ошибка сборки',
}

export function formatDate(value: unknown): string {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU')
}