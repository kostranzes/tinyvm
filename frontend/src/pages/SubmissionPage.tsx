import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, describeError } from '../api'
import type { SubmissionDetail } from '../api'
import { useAuth } from '../auth/auth-context'
import { VERDICT_TEXT, formatDate } from '../components/verdict-text'

type Loaded = { id: string; data: SubmissionDetail } | { id: string; error: string }

// Ответ может быть плоским или в обёртке {submission: ...}.
function unwrap(raw: Record<string, unknown>): SubmissionDetail {
  const inner = raw.submission
  const o = typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>) : raw
  return o as unknown as SubmissionDetail
}

export function SubmissionPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [result, setResult] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!id || !user) return
    let cancelled = false
    api
      .mySubmission(id)
      .then((raw) => {
        if (!cancelled) setResult({ id, data: unwrap(raw) })
      })
      .catch((e) => {
        if (!cancelled) setResult({ id, error: describeError(e) })
      })
    return () => {
      cancelled = true
    }
  }, [id, user])

  if (!user) {
    return (
      <p className="muted">
        <Link to="/login">Войдите</Link>, чтобы увидеть отправку.
      </p>
    )
  }

  const current = result !== null && result.id === id ? result : null

  return (
    <>
      <p>
        <Link to="/submissions">← Мои отправки</Link>
      </p>
      {current === null ? (
        <p className="muted">Загрузка…</p>
      ) : 'error' in current ? (
        <p className="error">{current.error}</p>
      ) : (
        <SubmissionView data={current.data} />
      )}
    </>
  )
}

function SubmissionView({ data }: { data: SubmissionDetail }) {
  return (
    <>
      <h1>Отправка №{data.id}</h1>
      <p>
        Задача: <Link to={`/tasks/${data.task}`}>{data.task}</Link>
        <br />
        Вердикт: <strong>{VERDICT_TEXT[data.verdict] ?? data.verdict}</strong>
        <br />
        <span className="muted">
          Инструкций: {data.instructionCount ?? '—'}, {formatDate(data.createdAt)}
        </span>
      </p>

      <h2>Код</h2>
      <pre>{data.source}</pre>

      {data.details !== undefined && data.details !== null && (
        <>
          <h2>Подробности</h2>
          <pre>{JSON.stringify(data.details, null, 2)}</pre>
        </>
      )}
    </>
  )
}