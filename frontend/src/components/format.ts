export interface DumpRow {
  address: string
  bytes: string[]
  ascii: string
}

// data: hex-строка без пробелов ("0a00..."), address: "0x110000".
// 16 байт на строку, справа печатные ASCII-символы.
export function dumpRows(data: string, address: string): DumpRow[] {
  const bytes = data.match(/../g) ?? []
  const parsed = Number(address)
  const base = Number.isFinite(parsed) ? parsed : 0
  const rows: DumpRow[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16)
    const ascii = chunk
      .map((b) => {
        const code = parseInt(b, 16)
        return code >= 32 && code < 127 ? String.fromCharCode(code) : '.'
      })
      .join('')
    rows.push({ address: '0x' + (base + i).toString(16).padStart(6, '0'), bytes: chunk, ascii })
  }
  return rows
}