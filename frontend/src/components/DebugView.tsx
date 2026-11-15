import { useEffect, useRef, useState } from 'react'
import { ApiError, api, describeError } from '../api'
import type { DebugCreated, EngineState } from '../api'
import { hexDump } from './format'

interface Row {
  address: string
  text: string
  current: boolean
}

function formatAddress(value: unknown): string {
  if (typeof value === 'number') return '0x' + value.toString(16)
  if (typeof value === 'string') return value
  return ''
}

// Формат дизассемблера в README не описан, поэтому разбор терпимый.
function toRows(raw: unknown): Row[] {
  let list: unknown = raw
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'instructions' in raw) {
    list = raw.instructions
  }
  if (!Array.isArray(list)) return []

  return list.map((item): Row => {
    if (typeof item !== 'object' || item === null) {
      return { address: '', text: String(item), current: false }
    }
    const o = item as Record<string, unknown>
    const mnemonic = typeof o.mnemonic === 'string' ? o.mnemonic : ''
    const operands = typeof o.op_str === 'string' ? o.op_str : ''
    const text =
      typeof o.text === 'string'
        ? o.text
        : mnemonic !== ''
          ? `${mnemonic} ${operands}`.trim()
          : JSON.stringify(item)
    return { address: formatAddress(o.address), text, current: o.is_current === true }
  })
}

interface View {
  state: EngineState
  prev: Record<string, string>
  rows: Row[]
}

interface Props {
  initial: DebugCreated
  onClose: () => void
}

interface Watch {
  address: string
  size: number
}

interface MemoryView {
  watch: Watch
  data: string | null
  error: string | null
}

export function DebugView({ initial, onClose }: Props) {
  const id = String(initial.sessionId)
  const [view, setView] = useState<View>({
    state: initial.state,
    prev: initial.state.registers,
    rows: toRows(initial.disassembly),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dead, setDead] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const [memAddr, setMemAddr] = useState('0x110000')
  const [memSize, setMemSize] = useState('64')
  const [memory, setMemory] = useState<MemoryView | null>(null)

  async function readMemory(watch: Watch) {
    try {
      const r = await api.sessionMemory(id, watch.address, watch.size)
      const failed = r.error !== null && r.error !== undefined
      setMemory({
        watch,
        data: !failed && typeof r.data === 'string' ? r.data : null,
        error: failed ? JSON.stringify(r.error) : null,
      })
    } catch (e) {
      setMemory({ watch, data: null, error: describeError(e) })
    }
  }

  function handleReadMemory() {
    void readMemory({ address: memAddr.trim(), size: Number(memSize) })
  }

  // Прокрутить список так, чтобы текущая инструкция была посередине.
  useEffect(() => {
    const list = listRef.current
    const current = list?.querySelector<HTMLElement>('[data-current="true"]')
    if (list && current) list.scrollTop = current.offsetTop - list.clientHeight / 2
  }, [view.rows])

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      const r = await api.sessionState(id)
      setView((v) => ({ state: r.state, prev: v.state.registers, rows: toRows(r.disassembly) }))
      if (memory) await readMemory(memory.watch)
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'session_lost' || e.code === 'session_not_found')) {
        setDead(true)
      }
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const { state, prev, rows } = view
  const canStep = !dead && !busy && (state.status === 'ready' || state.status === 'running')

  return (
    <div className="debug">
      <h3>Отладка</h3>
      <p>
        Статус: <strong>{state.status}</strong>
        <span className="muted"> Выполнено инструкций: {state.instructionCount}</span>
      </p>
      {state.error !== null && state.error !== undefined && (
        <p className="error">Ошибка программы: {JSON.stringify(state.error)}</p>
      )}

      <div className="debug-buttons">
        <button type="button" onClick={() => act(() => api.sessionStep(id, 1))} disabled={!canStep}>
          Шаг
        </button>
        <button type="button" onClick={() => act(() => api.sessionStep(id, 10))} disabled={!canStep}>
          Шаг ×10
        </button>
        <button type="button" onClick={() => act(() => api.sessionRun(id))} disabled={!canStep}>
          Выполнить до конца
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>
          Закрыть
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="debug-grid">
        <div>
          <div className="muted">Дизассемблер</div>
          <div className="disasm" ref={listRef}>
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
        </div>
        <div>
          <div className="muted">Регистры</div>
          <table className="reg-table">
            <tbody>
              {Object.entries(state.registers).map(([name, value]) => (
                <tr key={name} className={prev[name] !== value ? 'changed' : undefined}>
                  <td>{name}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h3>Память</h3>
      <div className="field-row">
        <label>
          <span className="muted">Адрес</span>
          <input value={memAddr} onChange={(e) => setMemAddr(e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span className="muted">Размер (байт, до 4096)</span>
          <input
            type="number"
            min={1}
            max={4096}
            value={memSize}
            onChange={(e) => setMemSize(e.target.value)}
          />
        </label>
        <button type="button" onClick={handleReadMemory} disabled={busy || dead}>
          Прочитать
        </button>
      </div>
      {memory?.error && <p className="error">Ошибка чтения: {memory.error}</p>}
      {memory?.data !== null && memory?.data !== undefined && (
        <pre>{hexDump(memory.data, memory.watch.address)}</pre>
      )}
    </div>
  )
}