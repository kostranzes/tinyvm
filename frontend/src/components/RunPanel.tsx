import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api, describeError } from '../api'
import type { RunRequest, RunResult } from '../api'
import { useAuth } from '../auth/auth-context'

// Регистры, которые движок разрешает записывать.
const WRITABLE = [
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
]

function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// 16 байт на строку: "0a 00 00 ..."
function hexDump(data: string): string {
  const bytes = data.match(/../g) ?? []
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(bytes.slice(i, i + 16).join(' '))
  }
  return lines.join('\n')
}

function describeRunError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_request') {
      return 'Неверные данные. Проверьте регистры, адреса и размеры: числа десятичные или 0x…, данные памяти это hex-байты.'
    }
    const body =
      typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {}
    const parts = [describeError(e)]
    if (typeof body.message === 'string') parts.push(body.message)
    if (typeof body.stage === 'string') parts.push(`Этап: ${body.stage}`)
    if (body.engineError !== undefined) parts.push(`Ошибка движка: ${show(body.engineError)}`)
    return parts.join('\n')
  }
  return describeError(e)
}

interface Props {
  source: string
  defaultLimit: number
}

export function RunPanel({ source, defaultLimit }: Props) {
  const { user } = useAuth()
  const [regs, setRegs] = useState<Record<string, string>>({})
  const [memAddr, setMemAddr] = useState('0x110000')
  const [memData, setMemData] = useState('')
  const [readAddr, setReadAddr] = useState('0x110000')
  const [readSize, setReadSize] = useState('')
  const [limit, setLimit] = useState(String(defaultLimit))
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function buildRequest(): RunRequest {
    const registers = Object.fromEntries(
      Object.entries(regs)
        .map(([name, value]) => [name, value.trim()] as const)
        .filter(([, value]) => value !== ''),
    )
    const data = memData.replace(/\s/g, '')

    const req: RunRequest = { source }
    if (Object.keys(registers).length > 0) req.registers = registers
    if (data !== '') req.memory = [{ address: memAddr.trim(), data }]
    if (readSize.trim() !== '') {
      req.readMemory = [{ address: readAddr.trim(), size: Number(readSize) }]
    }
    if (limit.trim() !== '') req.instructionLimit = Number(limit)
    return req
  }

  async function handleRun() {
    setPending(true)
    setError(null)
    try {
      setResult(await api.run(buildRequest()))
    } catch (e) {
      setResult(null)
      setError(describeRunError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <details className="run-panel" open>
      <summary>Запуск</summary>

      <h3>Начальные регистры</h3>
      <div className="reg-grid">
        {WRITABLE.map((name) => (
          <label key={name}>
            <span className="muted">{name}</span>
            <input
              value={regs[name] ?? ''}
              onChange={(e) => setRegs({ ...regs, [name]: e.target.value })}
              placeholder="0"
              spellCheck={false}
            />
          </label>
        ))}
      </div>

      <h3>Записать в память</h3>
      <div className="field-row">
        <label>
          <span className="muted">Адрес</span>
          <input value={memAddr} onChange={(e) => setMemAddr(e.target.value)} spellCheck={false} />
        </label>
        <label className="grow">
          <span className="muted">Данные (hex-байты, например 0a00000000000000)</span>
          <input value={memData} onChange={(e) => setMemData(e.target.value)} spellCheck={false} />
        </label>
      </div>

      <h3>Прочитать память после запуска</h3>
      <div className="field-row">
        <label>
          <span className="muted">Адрес</span>
          <input value={readAddr} onChange={(e) => setReadAddr(e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span className="muted">Размер (байт, до 4096)</span>
          <input
            type="number"
            min={1}
            max={4096}
            value={readSize}
            onChange={(e) => setReadSize(e.target.value)}
          />
        </label>
        <label>
          <span className="muted">Лимит инструкций</span>
          <input
            type="number"
            min={1}
            max={1000000}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      </div>

      {user ? (
        <button type="button" onClick={handleRun} disabled={pending}>
          {pending ? 'Выполнение…' : 'Запустить'}
        </button>
      ) : (
        <p className="muted">
          <Link to="/login">Войдите</Link>, чтобы запускать код.
        </p>
      )}

      {error && <p className="error pre-wrap">{error}</p>}
      {result && <RunResultView result={result} />}
    </details>
  )
}

function RunResultView({ result }: { result: RunResult }) {
  const { status, instructionCount, registers, error } = result.result
  const memory = result.memory ?? []

  return (
    <div className="run-result">
      <p>
        Статус: <strong>{status}</strong>
        <span className="muted">
          {' '}
          Инструкций: {instructionCount}, размер кода: {result.codeSize} байт
        </span>
      </p>
      {error !== null && error !== undefined && <p className="error">Ошибка: {show(error)}</p>}

      <h3>Регистры</h3>
      <table className="reg-table">
        <tbody>
          {Object.entries(registers).map(([name, value]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{show(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {memory.map((area, i) => (
        <div key={i}>
          <h3>
            Память {show(area.address)}
            {area.size !== undefined && `, ${area.size} байт`}
          </h3>
          {area.error !== null && area.error !== undefined ? (
            <p className="error">Ошибка чтения: {show(area.error)}</p>
          ) : (
            <pre>{typeof area.data === 'string' ? hexDump(area.data) : show(area.data)}</pre>
          )}
        </div>
      ))}
    </div>
  )
}