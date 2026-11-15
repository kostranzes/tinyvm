export interface Row {
  address: string
  text: string
  current: boolean
}

function formatAddress(value: unknown): string {
  if (typeof value === 'number') return '0x' + value.toString(16)
  if (typeof value === 'string') return value
  return ''
}

// Формат дизассемблера в README backend не описан, поэтому разбор терпимый.
export function toRows(raw: unknown): Row[] {
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