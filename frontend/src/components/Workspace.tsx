import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api, describeError } from '../api'
import type { EngineState, SubmitResult } from '../api'
import { useAuth } from '../auth/auth-context'
import { CodeEditor } from '../editor/CodeEditor'
import { toRows } from './disasm'
import type { Row } from './disasm'
import { InputsPanel } from './InputsPanel'
import { buildRequest, initialInputs } from './inputs'
import type { Inputs } from './inputs'
import { MemoryPanel } from './MemoryPanel'
import type { MemoryData } from './MemoryPanel'
import { RegistersPanel } from './RegistersPanel'
import { VerdictView } from './VerdictView'
import { VERDICT_TEXT } from './verdict-text'

// Конец области стека в движке: начальный rsp. Для кнопки «SP».
const STACK_END = 0x210000

function show(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// Для 400-х backend присылает подробности в теле; добавляем их к короткому тексту.
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

type Output =
  | { kind: 'none' }
  | { kind: 'error'; text: string }
  | { kind: 'run'; codeSize: number; state: EngineState }
  | { kind: 'verdict'; result: SubmitResult }

interface LogLine {
  time: string
  text: string
  error: boolean
}

// То, что показывают панели регистров и дизассемблера.
interface Machine {
  state: EngineState
  prev: Record<string, string> | null
  // null после обычного запуска: дизассемблера там нет
  rows: Row[] | null
}

interface Props {
  slug: string
  starterCode: string
  defaultLimit: number
}

export function Workspace({ slug, starterCode, defaultLimit }: Props) {
  const { user } = useAuth()
  const [source, setSource] = useState(starterCode)
  const [inputs, setInputs] = useState<Inputs>(() => initialInputs(defaultLimit))
  const [machine, setMachine] = useState<Machine | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [dead, setDead] = useState(false)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<Output>({ kind: 'none' })
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [memAddr, setMemAddr] = useState('0x110000')
  const [memSize, setMemSize] = useState('128')
  const [memory, setMemory] = useState<MemoryData | null>(null)

  // id сессии дублируется в ref, чтобы удалить её при уходе со страницы
  const sessionRef = useRef<string | null>(null)
  const disasmRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const rows = machine?.rows ?? null

  useEffect(() => {
    return () => {
      const id = sessionRef.current
      if (id !== null) void api.deleteSession(id).catch(() => {})
    }
  }, [])

  // Текущая инструкция в середину списка.
  useEffect(() => {
    const list = disasmRef.current
    const current = list?.querySelector<HTMLElement>('[data-current="true"]')
    if (list && current) list.scrollTop = current.offsetTop - list.clientHeight / 2
  }, [rows])

  // Журнал прокручивается к последней строке.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logLines])

  function log(text: string, error = false) {
    const time = new Date().toLocaleTimeString('ru-RU')
    setLogLines((lines) => [...lines.slice(-199), { time, text, error }])
  }

  function setSession(id: string | null) {
    sessionRef.current = id
    setSessionId(id)
  }

  async function closeSession() {
    const id = sessionRef.current
    setSession(null)
    if (id !== null) await api.deleteSession(id).catch(() => {})
  }

  async function readSessionMemory(id: string, address: string = memAddr) {
    const addr = address.trim()
    try {
      const r = await api.sessionMemory(id, addr, Number(memSize))
      const failed = r.error !== null && r.error !== undefined
      setMemory({
        address: addr,
        data: !failed && typeof r.data === 'string' ? r.data : null,
        error: failed ? show(r.error) : null,
      })
    } catch (e) {
      setMemory({ address: addr, data: null, error: describeRunError(e) })
    }
  }

  async function handleRun() {
    setBusy(true)
    try {
      await closeSession()
      const req = buildRequest(source, inputs)
      const addr = memAddr.trim()
      if (memSize.trim() !== '') req.readMemory = [{ address: addr, size: Number(memSize) }]
      const r = await api.run(req)
      setMachine({ state: r.result, prev: null, rows: null })
      const area = r.memory?.[0]
      if (area === undefined) {
        setMemory(null)
      } else {
        const failed = area.error !== null && area.error !== undefined
        setMemory({
          address: addr,
          data: !failed && typeof area.data === 'string' ? area.data : null,
          error: failed ? show(area.error) : null,
        })
      }
      setOutput({ kind: 'run', codeSize: r.codeSize, state: r.result })
      log(`Запуск: ${r.result.status}, инструкций: ${r.result.instructionCount}`)
    } catch (e) {
      const text = describeRunError(e)
      setOutput({ kind: 'error', text })
      log(text.split('\n')[0], true)
    } finally {
      setBusy(false)
    }
  }

  async function handleDebug() {
    setBusy(true)
    try {
      await closeSession()
      const created = await api.createSession(buildRequest(source, inputs))
      const id = String(created.sessionId)
      setSession(id)
      setDead(false)
      setMachine({ state: created.state, prev: null, rows: toRows(created.disassembly) })
      setOutput({ kind: 'none' })
      log(`Сессия отладки создана, код ${created.codeSize} байт`)
      await readSessionMemory(id)
    } catch (e) {
      const text = describeRunError(e)
      setOutput({ kind: 'error', text })
      log(text.split('\n')[0], true)
    } finally {
      setBusy(false)
    }
  }

  // Выполнить действие в сессии, затем обновить состояние, дизассемблер и память.
  async function act(label: string, action: (id: string) => Promise<unknown>) {
    const id = sessionRef.current
    if (id === null) return
    setBusy(true)
    try {
      await action(id)
      const r = await api.sessionState(id)
      setMachine((m) => ({
        state: r.state,
        prev: m ? m.state.registers : null,
        rows: toRows(r.disassembly),
      }))
      log(`${label}: ${r.state.status}, инструкций: ${r.state.instructionCount}`)
      if (r.state.error !== null && r.state.error !== undefined) {
        log(`Ошибка программы: ${show(r.state.error)}`, true)
      }
      await readSessionMemory(id)
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'session_lost' || e.code === 'session_not_found')) {
        setDead(true)
      }
      log(describeError(e), true)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    setBusy(true)
    await closeSession()
    setMachine(null)
    setMemory(null)
    setOutput({ kind: 'none' })
    setDead(false)
    log('Сброс')
    setBusy(false)
  }

  async function handleSubmit() {
    setBusy(true)
    log('Отправка решения…')
    try {
      const result = await api.submit(slug, source)
      setOutput({ kind: 'verdict', result })
      log(`Вердикт: ${VERDICT_TEXT[result.verdict] ?? result.verdict}`)
    } catch (e) {
      const text = describeError(e)
      setOutput({ kind: 'error', text })
      log(text, true)
    } finally {
      setBusy(false)
    }
  }

  async function readAt(address: string) {
    const id = sessionRef.current
    if (id === null) return
    setMemAddr(address)
    setBusy(true)
    await readSessionMemory(id, address)
    setBusy(false)
  }

  function handleIp() {
    const rip = machine
      ? Object.entries(machine.state.registers).find(([k]) => k.toLowerCase() === 'rip')?.[1]
      : undefined
    if (rip !== undefined) void readAt(rip)
  }

  // Начальный rsp стоит на конце стека, поэтому читаем область, которая помещается в стек.
  function handleSp() {
    const rsp = machine
      ? Object.entries(machine.state.registers).find(([k]) => k.toLowerCase() === 'rsp')?.[1]
      : undefined
    if (rsp === undefined) return
    const size = Number(memSize) || 64
    const start = Math.min(Number(rsp), STACK_END - size)
    void readAt('0x' + start.toString(16))
  }

  const status = machine?.state.status
  const canStep =
    sessionId !== null && !dead && !busy && (status === 'ready' || status === 'running')
  const canRead = sessionId !== null && !dead && !busy

  return (
    <>
      <div className="toolbar">
        {user ? (
          <>
            <button type="button" onClick={handleRun} disabled={busy}>
              ▶ Запустить
            </button>
            <button type="button" className="secondary" onClick={handleDebug} disabled={busy}>
              ⚙ Отладить
            </button>
            <button
              type="button"
              onClick={() => void act('Шаг', (id) => api.sessionStep(id, 1))}
              disabled={!canStep}
            >
              → Шаг
            </button>
            <button
              type="button"
              onClick={() => void act('Шаг ×10', (id) => api.sessionStep(id, 10))}
              disabled={!canStep}
            >
              ⇉ Шаг ×10
            </button>
            <button
              type="button"
              onClick={() => void act('До конца', (id) => api.sessionRun(id))}
              disabled={!canStep}
            >
              ⏭ До конца
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              disabled={busy || (machine === null && sessionId === null)}
            >
              ↺ Сброс
            </button>
            <button type="button" onClick={handleSubmit} disabled={busy}>
              ✓ Отправить
            </button>
          </>
        ) : (
          <span className="muted">
            <Link to="/login">Войдите</Link>, чтобы запускать, отлаживать и отправлять код.
          </span>
        )}
        <span className="toolbar-spacer" />
        <span className="muted">
          {machine
            ? `Статус: ${machine.state.status} · Инструкций: ${machine.state.instructionCount}`
            : 'Инструкций: 0'}
        </span>
      </div>

      <InputsPanel inputs={inputs} onChange={setInputs} />

      <div className="workspace">
        <section className="panel">
          <div className="panel-head">Редактор кода</div>
          <CodeEditor initialValue={starterCode} onChange={setSource} />
          {rows !== null && (
            <>
              <div className="panel-head sub">Дизассемблер</div>
              <div className="disasm" ref={disasmRef}>
                {rows.length === 0 && (
                  <div className="muted">Формат дизассемблера не распознан, см. ответ в Network.</div>
                )}
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={row.current ? 'disasm-row current' : 'disasm-row'}
                    data-current={row.current}
                  >
                    <span className="addr">{row.address}</span>
                    <span>{row.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">Регистры процессора</div>
          <RegistersPanel state={machine?.state ?? null} prev={machine?.prev ?? null} />
        </section>

        <section className="panel">
          <div className="panel-head">Память</div>
          <MemoryPanel
            address={memAddr}
            size={memSize}
            onAddress={setMemAddr}
            onSize={setMemSize}
            onRead={() => void readAt(memAddr)}
            onIp={handleIp}
            onSp={handleSp}
            canRead={canRead}
            data={memory}
          />
        </section>
      </div>

      <div className="bottom">
        <section className="panel">
          <div className="panel-head">Вывод</div>
          <div className="panel-body bottom-body">
            <OutputView output={output} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">Журнал</div>
          <div className="panel-body bottom-body" ref={logRef}>
            {logLines.length === 0 && <span className="muted">Пусто</span>}
            {logLines.map((line, i) => (
              <div key={i} className={line.error ? 'log-line err' : 'log-line'}>
                <span className="time">{line.time}</span> {line.text}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

function OutputView({ output }: { output: Output }) {
  if (output.kind === 'none') return <span className="muted">(нет вывода)</span>
  if (output.kind === 'error') return <p className="error pre-wrap">{output.text}</p>
  if (output.kind === 'verdict') return <VerdictView result={output.result} />
  const { state, codeSize } = output
  return (
    <div>
      Статус: <strong>{state.status}</strong>
      <span className="muted">
        {' '}
        Инструкций: {state.instructionCount}, размер кода: {codeSize} байт
      </span>
      {state.error !== null && state.error !== undefined && (
        <p className="error">Ошибка: {show(state.error)}</p>
      )}
    </div>
  )
}