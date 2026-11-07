import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, describeError } from '../api'
import type { TaskSummary } from '../api'
import { useAuth } from '../auth/auth-context'

type State =
  | { status: 'loading' }
  | { status: 'ok'; tasks: TaskSummary[] }
  | { status: 'error'; message: string }

export function HomePage() {
  const { user } = useAuth()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    api
      .tasks()
      .then((r) => {
        if (!cancelled) setState({ status: 'ok', tasks: r.tasks })
      })
      .catch((e) => {
        if (!cancelled) setState({ status: 'error', message: describeError(e) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <h1>Задачи</h1>
      {!user && (
        <p className="muted">
          <Link to="/login">Войдите</Link> или <Link to="/register">зарегистрируйтесь</Link>,
          чтобы отправлять решения. Читать задачи можно и без входа.
        </p>
      )}
      {state.status === 'loading' && <p className="muted">Загрузка…</p>}
      {state.status === 'error' && <p className="error">{state.message}</p>}
      {state.status === 'ok' && (
        <ul className="task-list">
          {state.tasks.map((task) => (
            <li key={task.slug}>
              <Link to={`/tasks/${task.slug}`}>
                <span>{task.title}</span>
                <span className="badge">{task.difficulty}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}