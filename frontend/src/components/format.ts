// Дамп памяти: 16 байт на строку, с адресом строки.
// data: hex-строка без пробелов ("0a00..."), address: "0x110000" или число.
export function hexDump(data: string, address?: string): string {
  const bytes = data.match(/../g) ?? []
  let base = 0
  if (address !== undefined) {
    const parsed = Number(address)
    if (Number.isFinite(parsed)) base = parsed
  }
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += 16) {
    const hex = bytes.slice(i, i + 16).join(' ')
    lines.push(address === undefined ? hex : `0x${(base + i).toString(16)}  ${hex}`)
  }
  return lines.join('\n')
}