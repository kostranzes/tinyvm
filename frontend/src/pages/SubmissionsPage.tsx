import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, describeError } from '../api'
import type { SubmissionSummary } from '../api'
import { useAuth } from '../auth/auth-context'
import { VERDICT_TEXT, formatDate } from '../components/verdict-text'

type State =
  | { status: 'loading' }
  | { status: 'ok'; items: SubmissionSummary[] }
  | { status: 'error'; message: string }

export function SubmissionsPage() {
  const { user } = useAuth()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api
      .mySubmissions()
      .then((r) => {
        if (!cancelled) setState({ status: 'ok', items: r.submissions })
      })
      .catch((e) => {
        if (!cancelled) setState({ status: 'error', message: describeError(e) })
      })
    return () => {
      cancelled = true
    }
  }, [user])

  if (!user) {
    return (
      <p className="muted">
        <Link to="/login">Войдите</Link>, чтобы увидеть свои отправки.
      </p>
    )
  }

  return (
    <>
      <h1>Мои отправки</h1>
      {state.status === 'loading' && <p className="muted">Загрузка…</p>}
      {state.status === 'error' && <p className="error">{state.message}</p>}
      {state.status === 'ok' && state.items.length === 0 && (
        <p className="muted">Отправок пока нет.</p>
      )}
      {state.status === 'ok' && state.items.length > 0 && (
        <table className="history">
          <thead>
            <tr>
              <th>№</th>
              <th>Задача</th>
              <th>Вердикт</th>
              <th>Инструкций</th>
              <th>Когда</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/submissions/${s.id}`}>{s.id}</Link>
                </td>
                <td>
                  <Link to={`/tasks/${s.task}`}>{s.task}</Link>
                </td>
                <td className={s.verdict === 'accepted' ? 'ok-text' : 'fail-text'}>
                  {VERDICT_TEXT[s.verdict] ?? s.verdict}
                </td>
                <td>{s.instructionCount ?? '—'}</td>
                <td className="muted">{formatDate(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}