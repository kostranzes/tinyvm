import type { EngineState } from '../api'

const GROUPS: [string, string[]][] = [
  ['Общего назначения', ['rax', 'rbx', 'rcx', 'rdx']],
  ['Индексные и указатели', ['rsi', 'rdi', 'rbp', 'rsp']],
  ['Расширенные', ['r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15']],
]
const SPECIAL = ['rip', 'rflags']

// Номера битов в rflags.
const FLAGS: [string, number][] = [
  ['CF', 0],
  ['PF', 2],
  ['AF', 4],
  ['ZF', 6],
  ['SF', 7],
  ['IF', 9],
  ['DF', 10],
  ['OF', 11],
]

function lowerKeys(regs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(regs).map(([k, v]) => [k.toLowerCase(), v]))
}

function decimal(value: string): string {
  try {
    return BigInt(value).toString()
  } catch {
    return ''
  }
}

function flagIsSet(rflags: string | undefined, bit: number): boolean {
  if (rflags === undefined) return false
  try {
    return ((BigInt(rflags) >> BigInt(bit)) & 1n) === 1n
  } catch {
    return false
  }
}

interface RegProps {
  name: string
  regs: Record<string, string>
  // Регистры на предыдущем шаге; null, если сравнивать не с чем.
  before: Record<string, string> | null
  extra?: string
}

function Reg({ name, regs, before, extra }: RegProps) {
  const value = regs[name]
  if (value === undefined) return null
  const changed = before !== null && before[name] !== value
  const classes = ['reg', extra, changed ? 'changed' : ''].filter(Boolean).join(' ')
  return (
    <div className={classes}>
      <span className="reg-name">{name.toUpperCase()}</span>
      <span className="reg-val">{value}</span>
      <span className="reg-dec">{decimal(value)}</span>
    </div>
  )
}

interface Props {
  state: EngineState | null
  // Регистры на предыдущем шаге; null, если сравнивать не с чем.
  prev: Record<string, string> | null
}

export function RegistersPanel({ state, prev }: Props) {
  if (state === null) {
    return (
      <div className="panel-body muted">Запустите или отладьте программу, чтобы увидеть регистры.</div>
    )
  }

  const regs = lowerKeys(state.registers)
  const before = prev === null ? null : lowerKeys(prev)
  const known = new Set([...GROUPS.flatMap(([, names]) => names), ...SPECIAL])
  const others = Object.keys(regs).filter((name) => !known.has(name))

  return (
    <div className="panel-body">
      <div className="reg-group-title">Указатель инструкции</div>
      <Reg name="rip" extra="rip" regs={regs} before={before} />

      {GROUPS.map(([title, names]) => (
        <div key={title}>
          <div className="reg-group-title">{title}</div>
          {names.map((name) => (
            <Reg key={name} name={name} regs={regs} before={before} />
          ))}
        </div>
      ))}

      {others.length > 0 && (
        <div>
          <div className="reg-group-title">Прочее</div>
          {others.map((name) => (
            <Reg key={name} name={name} regs={regs} before={before} />
          ))}
        </div>
      )}

      <div className="reg-group-title">Флаги</div>
      <div className="flags">
        {FLAGS.map(([name, bit]) => (
          <span key={name} className={flagIsSet(regs.rflags, bit) ? 'flag on' : 'flag'}>
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}