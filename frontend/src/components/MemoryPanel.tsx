import { dumpRows } from './format'

export interface MemoryData {
  address: string
  data: string | null
  error: string | null
}

interface Props {
  address: string
  size: string
  onAddress: (value: string) => void
  onSize: (value: string) => void
  onRead: () => void
  onIp: () => void
  onSp: () => void
  // Читать память можно только в сессии отладки.
  canRead: boolean
  data: MemoryData | null
}

export function MemoryPanel({
  address,
  size,
  onAddress,
  onSize,
  onRead,
  onIp,
  onSp,
  canRead,
  data,
}: Props) {
  return (
    <div className="panel-body">
      <div className="mem-controls">
        <label>
          Адрес
          <input value={address} onChange={(e) => onAddress(e.target.value)} spellCheck={false} />
        </label>
        <label>
          Размер
          <input
            type="number"
            min={1}
            max={4096}
            value={size}
            onChange={(e) => onSize(e.target.value)}
          />
        </label>
        <button type="button" onClick={onRead} disabled={!canRead}>
          Читать
        </button>
        <button type="button" className="secondary" onClick={onIp} disabled={!canRead}>
          IP
        </button>
        <button type="button" className="secondary" onClick={onSp} disabled={!canRead}>
          SP
        </button>
      </div>

      {data === null && (
        <p className="muted">
          Память читается после «Запустить» и после каждого шага отладки. Область задают поля выше.
        </p>
      )}
      {data?.error && <p className="error">Ошибка чтения: {data.error}</p>}
      {data?.data != null && (
        <div className="mem-dump">
          {dumpRows(data.data, data.address).map((row) => (
            <div className="mem-row" key={row.address}>
              <span className="mem-addr">{row.address}</span>
              <span className="mem-bytes">
                {row.bytes.map((b, i) => (
                  <span key={i} className={b === '00' ? 'zero' : undefined}>
                    {b}
                  </span>
                ))}
              </span>
              <span className="mem-ascii">{row.ascii}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}