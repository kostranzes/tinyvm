import type { SubmitResult } from '../api'
import { VERDICT_TEXT } from './verdict-text'

function show(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function VerdictView({ result }: { result: SubmitResult }) {
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