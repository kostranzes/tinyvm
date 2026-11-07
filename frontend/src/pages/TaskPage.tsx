import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, describeError } from '../api'
import type { Task } from '../api'
import { CodeEditor } from '../editor/CodeEditor'

// Результат запроса хранится вместе со slug, для которого он получен.
// Пока slug в адресе и в результате не совпадают, показываем загрузку.
type Loaded = { slug: string; task: Task } | { slug: string; error: string }

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function TaskPage() {
  const { slug } = useParams()
  const [result, setResult] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    api
      .task(slug)
      .then((task) => {
        if (!cancelled) setResult({ slug, task })
      })
      .catch((e) => {
        if (!cancelled) setResult({ slug, error: describeError(e) })
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const current = result !== null && result.slug === slug ? result : null

  return (
    <>
      <p>
        <Link to="/">← Все задачи</Link>
      </p>
      {current === null ? (
        <p className="muted">Загрузка…</p>
      ) : 'error' in current ? (
        <p className="error">{current.error}</p>
      ) : (
        // key: при переходе на другую задачу редактор создаётся заново со своим стартовым кодом
        <TaskView key={current.slug} task={current.task} />
      )}
    </>
  )
}

function TaskView({ task }: { task: Task }) {
  const [source, setSource] = useState(task.starterCode)

  return (
    <>
      <h1>
        {task.title} <span className="badge">{task.difficulty}</span>
      </h1>
      <p className="muted">Лимит инструкций: {task.instructionLimit}</p>

      <h2>Описание</h2>
      <p className="description">{task.description}</p>

      <h2>Решение</h2>
      <CodeEditor initialValue={task.starterCode} onChange={setSource} />
      <p className="muted">
        Строк: {source.split('\n').length}, символов: {source.length}
      </p>

      <h2>Примеры тестов</h2>
      {task.visibleTests.map((test) => (
        <div className="test" key={test.position}>
          <h3>Тест {test.position}</h3>
          <div className="test-grid">
            <div>
              <div className="muted">Вход</div>
              <pre>{pretty(test.input)}</pre>
            </div>
            <div>
              <div className="muted">Ожидается</div>
              <pre>{pretty(test.expected)}</pre>
            </div>
          </div>
        </div>
      ))}
      <p className="muted">Скрытых тестов: {task.hiddenTestCount}</p>
    </>
  )
}