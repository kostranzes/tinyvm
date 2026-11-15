import type { RunRequest } from '../api'

// Регистры, которые движок разрешает записывать.
export const WRITABLE = [
  'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp',
  'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
]

// Начальное состояние программы: то, что вводит пользователь.
export interface Inputs {
  regs: Record<string, string>
  memAddr: string
  memData: string
  limit: string
}

export function initialInputs(limit: number): Inputs {
  return { regs: {}, memAddr: '0x110000', memData: '', limit: String(limit) }
}

// Пустые поля в запрос не попадают. Числа остаются строками, как требует backend.
export function buildRequest(source: string, inputs: Inputs): RunRequest {
  const registers = Object.fromEntries(
    Object.entries(inputs.regs)
      .map(([name, value]) => [name, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  )
  const data = inputs.memData.replace(/\s/g, '')

  const req: RunRequest = { source }
  if (Object.keys(registers).length > 0) req.registers = registers
  if (data !== '') req.memory = [{ address: inputs.memAddr.trim(), data }]
  if (inputs.limit.trim() !== '') req.instructionLimit = Number(inputs.limit)
  return req
}