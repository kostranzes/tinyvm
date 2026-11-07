import { useState } from 'react'
import { Link } from 'react-router'
import { api, describeError } from '../api'
import type { SubmitResult, Verdict } from '../api'
import { useAuth } from '../auth/auth-context'

const VERDICT_TEXT: Record<Verdict, string> = {
  accepted: 'Принято',
  wrong_answer: 'Неверный ответ',
  runtime_error: 'Ошибка выполнения',
  limit_exceeded: 'Превышен лимит инструкций',
  assembly_error: 'Ошибка сборки',
}

function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function SubmitPanel({ slug, source }: { slug: string; source: string }) {
  const { user } = useAuth()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setPending(true)
    setError(null)
    try {
      setResult(await api.submit(slug, source))
    } catch (e) {
      setResult(null)
      setError(describeError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="submit-panel">
      {user ? (
        <button type="button" onClick={handleSubmit} disabled={pending}>
          {pending ? 'Проверка…' : 'Отправить'}
        </button>
      ) : (
        <p className="muted">
          <Link to="/login">Войдите</Link>, чтобы отправить решение.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {result && <VerdictView result={result} />}
    </div>
  )
}

function VerdictView({ result }: { result: SubmitResult }) {
  const ok = result.verdict === 'accepted'
  const failed = result.failedTest

  return (
    <div className={ok ? 'verdict verdict-ok' : 'verdict verdict-fail'}>
      <strong>{VERDICT_TEXT[result.verdict] ?? result.verdict}</strong>
      {result.passed !== undefined && result.total !== undefined && (
        <span className="muted">
          {' '}
          Тестов пройдено: {result.passed} из {result.total}
        </span>
      )}
      {result.instructionCount !== undefined && (
        <div className="muted">Инструкций выполнено: {result.instructionCount}</div>
      )}
      {result.message && <pre>{result.message}</pre>}
      {failed && (
        <div>
          {failed.hidden ? (
            <p>Не пройден скрытый тест {failed.position}.</p>
          ) : (
            <p>Не пройден тест {failed.position}.</p>
          )}
          {failed.engineError && <p className="muted">Ошибка движка: {failed.engineError}</p>}
          {failed.mismatches && failed.mismatches.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Что</th>
                  <th>Ожидалось</th>
                  <th>Получено</th>
                </tr>
              </thead>
              <tbody>
                {failed.mismatches.map((m, i) => (
                  <tr key={i}>
                    <td>{m.what}</td>
                    <td>{show(m.expected)}</td>
                    <td>{show(m.actual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}