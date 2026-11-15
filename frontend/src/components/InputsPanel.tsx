import { WRITABLE } from './inputs'
import type { Inputs } from './inputs'

interface Props {
  inputs: Inputs
  onChange: (next: Inputs) => void
}

// Начальные регистры, память и лимит. Применяются при «Запустить» и «Отладить».
export function InputsPanel({ inputs, onChange }: Props) {
  return (
    <details className="run-panel">
      <summary>Начальные данные: регистры, память, лимит</summary>

      <h3>Регистры</h3>
      <div className="reg-grid">
        {WRITABLE.map((name) => (
          <label key={name}>
            <span className="muted">{name}</span>
            <input
              value={inputs.regs[name] ?? ''}
              onChange={(e) =>
                onChange({ ...inputs, regs: { ...inputs.regs, [name]: e.target.value } })
              }
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
          <input
            value={inputs.memAddr}
            onChange={(e) => onChange({ ...inputs, memAddr: e.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="grow">
          <span className="muted">Данные (hex-байты, например 0a00000000000000)</span>
          <input
            value={inputs.memData}
            onChange={(e) => onChange({ ...inputs, memData: e.target.value })}
            spellCheck={false}
          />
        </label>
      </div>

      <h3>Лимит инструкций</h3>
      <div className="field-row">
        <label>
          <input
            type="number"
            min={1}
            max={1000000}
            value={inputs.limit}
            onChange={(e) => onChange({ ...inputs, limit: e.target.value })}
          />
        </label>
      </div>
    </details>
  )
}