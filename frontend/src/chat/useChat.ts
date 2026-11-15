import { useEffect, useRef, useState } from 'react'

// Адрес WebSocket-чата. Задаётся на этапе сборки (VITE_CHAT_URL).
const CHAT_URL = (import.meta.env.VITE_CHAT_URL as string | undefined) ?? 'ws://localhost:8080'

const TYPING_REFRESH_MS = 1500 // как часто повторять typing:true, пока идёт ввод
const TYPING_STOP_MS = 2000 // через сколько после последней клавиши слать typing:false
const TYPING_EXPIRE_MS = 4000 // запасной таймер получателя, если false потерялся
const MAX_MESSAGES = 500

// idle: не подключены; online: вошли в чат; offline: соединение потеряно после входа
export type ChatStatus = 'idle' | 'connecting' | 'online' | 'offline'

export interface ChatMessage {
  id: string
  kind: 'message' | 'system' | 'private'
  sender: string | null
  // только для kind: 'private': получатель
  to?: string
  text: string
  timestamp: string
}

function parseServer(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null
  try {
    const value: unknown = JSON.parse(data)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ChatMessage[] => {
    if (typeof item !== 'object' || item === null) return []
    const o = item as Record<string, unknown>
    return [
      {
        id: str(o.id),
        kind: 'message',
        sender: str(o.sender),
        text: str(o.message),
        timestamp: str(o.timestamp),
      },
    ]
  })
}

// «/pm Имя текст». В именах бывают пробелы, поэтому берём самое длинное имя
// из списка онлайн, с которого начинается остаток строки.
function parsePm(text: string, users: string[]): { to: string; message: string } | null {
  const rest = text.trim().replace(/^\/pm\s+/i, '')
  let best: string | null = null
  for (const u of users) {
    if (rest.toLowerCase().startsWith(u.toLowerCase() + ' ') && (best === null || u.length > best.length)) {
      best = u
    }
  }
  if (best === null) return null
  const message = rest.slice(best.length).trim()
  return message === '' ? null : { to: best, message }
}

export function useChat() {
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [name, setName] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState<string[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  // Вошли ли мы в чат на текущем соединении (пришёл ответ joined).
  const joinedRef = useRef(false)
  // Таймеры «собеседник печатает», по имени.
  const typingTimers = useRef(new Map<string, number>())
  // Свой статус набора.
  const stopTimer = useRef<number | null>(null)
  const iAmTyping = useRef(false)
  const lastTypingSent = useRef(0)

  // При уходе со страницы закрываем соединение и таймеры.
  useEffect(() => {
    const timers = typingTimers.current
    return () => {
      const ws = socketRef.current
      socketRef.current = null
      ws?.close(1000)
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current)
    }
  }, [])

  function pushMessage(message: ChatMessage) {
    setMessages((list) => [...list.slice(-(MAX_MESSAGES - 1)), message])
  }

  function pushSystem(text: string) {
    pushMessage({
      id: `local-${Date.now()}`,
      kind: 'system',
      sender: null,
      text,
      timestamp: new Date().toISOString(),
    })
  }

  // Чужой индикатор набора.
  function setTypingUser(who: string, active: boolean) {
    if (who === '') return
    const timers = typingTimers.current
    const old = timers.get(who)
    if (old !== undefined) {
      window.clearTimeout(old)
      timers.delete(who)
    }
    if (active) {
      timers.set(
        who,
        window.setTimeout(() => {
          timers.delete(who)
          setTyping((list) => list.filter((n) => n !== who))
        }, TYPING_EXPIRE_MS),
      )
      setTyping((list) => (list.includes(who) ? list : [...list, who]))
    } else {
      setTyping((list) => list.filter((n) => n !== who))
    }
  }

  function clearAllTyping() {
    const timers = typingTimers.current
    timers.forEach((t) => window.clearTimeout(t))
    timers.clear()
    setTyping([])
  }

  function sendRaw(data: object) {
    const ws = socketRef.current
    if (ws !== null && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  // Свой индикатор набора: true повторяется не чаще раза в 1,5 с,
  // false уходит через 2 с после последнего ввода.
  function notifyTyping(active: boolean) {
    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    if (active) {
      const now = Date.now()
      if (!iAmTyping.current || now - lastTypingSent.current >= TYPING_REFRESH_MS) {
        sendRaw({ type: 'typing', isTyping: true })
        iAmTyping.current = true
        lastTypingSent.current = now
      }
      stopTimer.current = window.setTimeout(() => notifyTyping(false), TYPING_STOP_MS)
    } else if (iAmTyping.current) {
      iAmTyping.current = false
      sendRaw({ type: 'typing', isTyping: false })
    }
  }

  function resetMyTyping() {
    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    iAmTyping.current = false
  }

  function join(rawName: string) {
    if (socketRef.current !== null) return
    setError(null)
    setStatus('connecting')
    joinedRef.current = false

    let ws: WebSocket
    try {
      ws = new WebSocket(CHAT_URL)
    } catch {
      setError('Некорректный адрес чата.')
      setStatus('idle')
      return
    }
    socketRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', name: rawName.trim() }))
    }

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) return
      const msg = parseServer(event.data)
      if (msg === null) return

      switch (msg.type) {
        case 'joined':
          joinedRef.current = true
          setName(str(msg.name))
          setStatus('online')
          break
        case 'history':
          // Заменяет список целиком: так при повторном входе нет дублей.
          setMessages(parseHistory(msg.messages))
          break
        case 'users':
          setUsers(
            Array.isArray(msg.users)
              ? msg.users.filter((u): u is string => typeof u === 'string')
              : [],
          )
          break
        case 'message': {
          const sender = str(msg.sender)
          pushMessage({
            id: str(msg.id) || `m-${Date.now()}`,
            kind: 'message',
            sender,
            text: str(msg.message),
            timestamp: str(msg.timestamp),
          })
          setTypingUser(sender, false)
          break
        }
        case 'system':
          pushMessage({
            id: str(msg.id) || `s-${Date.now()}`,
            kind: 'system',
            sender: null,
            text: str(msg.message),
            timestamp: str(msg.timestamp),
          })
          break
        case 'private': {
          const sender = str(msg.sender)
          pushMessage({
            id: str(msg.id) || `p-${Date.now()}`,
            kind: 'private',
            sender,
            to: str(msg.to),
            text: str(msg.message),
            timestamp: str(msg.timestamp),
          })
          setTypingUser(sender, false)
          break
        }
        case 'typing':
          setTypingUser(str(msg.name), msg.isTyping === true)
          break
        case 'error':
          setError(str(msg.message) || 'Ошибка чата.')
          // Не удалось войти (имя занято и т. п.): закрываем, можно попробовать снова.
          if (!joinedRef.current) ws.close(1000)
          break
      }
    }

    ws.onclose = () => {
      if (socketRef.current !== ws) return
      socketRef.current = null
      clearAllTyping()
      setUsers([])
      resetMyTyping()
      if (joinedRef.current) {
        joinedRef.current = false
        setStatus('offline')
        pushSystem('Соединение потеряно.')
      } else {
        setStatus('idle')
        setError((e) => e ?? 'Не удалось подключиться к чату. Запущен ли сервер?')
      }
    }
  }

  // Выход из чата по желанию пользователя.
  function leave() {
    const ws = socketRef.current
    socketRef.current = null
    joinedRef.current = false
    ws?.close(1000)
    clearAllTyping()
    resetMyTyping()
    setStatus('idle')
    setName(null)
    setMessages([])
    setUsers([])
    setError(null)
  }

  // Возвращает true, если сообщение ушло (тогда поле ввода можно очистить).
  function send(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed === '') return false

    if (/^\/pm(\s|$)/i.test(trimmed)) {
      const pm = parsePm(trimmed, users)
      if (pm === null) {
        setError('Формат: /pm Имя текст. Получатель должен быть в списке «Онлайн».')
        return false
      }
      setError(null)
      sendRaw({ type: 'private', to: pm.to, message: pm.message })
      notifyTyping(false)
      return true
    }

    setError(null)
    sendRaw({ type: 'message', message: trimmed })
    notifyTyping(false)
    return true
  }

  return { status, name, messages, typing, users, error, join, leave, send, notifyTyping }
}