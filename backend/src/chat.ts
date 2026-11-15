import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'

// Чат службы поддержки на WebSocket.
// Протокол: клиент шлёт join / message / typing, сервер шлёт joined / system /
// message / typing / error. Имя отправителя хранит сервер, клиентскому имени в
// message и typing не доверяем.

export interface ChatOptions {
  port: number
  // Единственный разрешённый Origin при рукопожатии (у WebSocket нет CORS).
  allowedOrigin: string
  host?: string
}

export interface ChatServer {
  // Реальный порт (полезно, если запрошен порт 0).
  port: number
  close: () => Promise<void>
}

const MAX_PAYLOAD = 4096 // байт в одном кадре
const MAX_NAME = 24
const MAX_TEXT = 1000
const MAX_CONNECTIONS = 100
const JOIN_TIMEOUT_MS = 30_000
const PING_INTERVAL_MS = 30_000
const RATE_WINDOW_MS = 10_000
const RATE_MAX = 30 // кадров за окно на соединение
const MAX_HISTORY = 50 // сколько последних сообщений получает новый участник

const ERRORS = {
  invalid_message: 'Некорректное сообщение.',
  invalid_name: `Имя: от 1 до ${MAX_NAME} символов, без управляющих символов.`,
  name_taken: 'Это имя уже занято.',
  not_joined: 'Сначала войдите в чат.',
  already_joined: 'Вы уже в чате.',
  message_too_long: `Сообщение длиннее ${MAX_TEXT} символов.`,
  user_not_found: 'Такого пользователя нет в чате.',
  pm_self: 'Нельзя написать самому себе.',
  rate_limited: 'Слишком часто. Подождите несколько секунд.',
} as const

type ErrorCode = keyof typeof ERRORS

const incoming = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join'), name: z.string() }),
  z.object({ type: z.literal('message'), message: z.string() }),
  z.object({ type: z.literal('typing'), isTyping: z.boolean() }),
  z.object({ type: z.literal('private'), to: z.string(), message: z.string() }),
])

interface Client {
  // null, пока клиент не прислал join
  name: string | null
  alive: boolean
  hits: number[]
  joinTimer: NodeJS.Timeout
}

function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length === 0 || name.length > MAX_NAME) return null
  if (/\p{Cc}/u.test(name)) return null
  return name
}

interface HistoryEntry {
  type: 'message'
  sender: string
  message: string
  timestamp: string
  id: string
}

export async function startChatServer(options: ChatOptions): Promise<ChatServer> {
  const clients = new Map<WebSocket, Client>()
  // Последние сообщения для новых участников. Хранятся в памяти и пропадают при перезапуске.
  const history: HistoryEntry[] = []

  const wss = new WebSocketServer({
    port: options.port,
    host: options.host,
    maxPayload: MAX_PAYLOAD,
    verifyClient: ({ origin }: { origin: string }) => origin === options.allowedOrigin,
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => reject(e)
    wss.once('error', onError)
    wss.once('listening', () => {
      wss.off('error', onError)
      resolve()
    })
  })
  wss.on('error', (e) => console.error('[chat] ошибка сервера:', e))

  const address = wss.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port

  function send(ws: WebSocket, data: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data))
  }

  function sendError(ws: WebSocket, code: ErrorCode) {
    send(ws, { type: 'error', code, message: ERRORS[code] })
  }

  // Рассылка только тем, кто вошёл в чат.
  function broadcast(data: object, except?: WebSocket) {
    const payload = JSON.stringify(data)
    for (const [ws, client] of clients) {
      if (client.name === null || ws === except) continue
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    }
  }

  function broadcastSystem(text: string) {
    broadcast({
      type: 'system',
      message: text,
      timestamp: new Date().toISOString(),
      id: randomUUID(),
    })
  }

  function isNameTaken(name: string): boolean {
    const lower = name.toLowerCase()
    for (const client of clients.values()) {
      if (client.name !== null && client.name.toLowerCase() === lower) return true
    }
    return false
  }

  function findByName(name: string): { ws: WebSocket; name: string } | null {
    const lower = name.trim().toLowerCase()
    for (const [ws, c] of clients) {
      if (c.name !== null && c.name.toLowerCase() === lower) return { ws, name: c.name }
    }
    return null
  }

  // Список имён вошедших участников рассылается всем при каждом входе и выходе.
  function broadcastUsers() {
    const users = [...clients.values()]
      .flatMap((c) => (c.name === null ? [] : [c.name]))
      .sort((a, b) => a.localeCompare(b))
    broadcast({ type: 'users', users })
  }

  function rateLimited(client: Client): boolean {
    const now = Date.now()
    client.hits = client.hits.filter((t) => now - t < RATE_WINDOW_MS)
    if (client.hits.length >= RATE_MAX) return true
    client.hits.push(now)
    return false
  }

  wss.on('connection', (ws) => {
    if (clients.size >= MAX_CONNECTIONS) {
      ws.close(1013, 'server_full')
      return
    }

    const client: Client = {
      name: null,
      alive: true,
      hits: [],
      joinTimer: setTimeout(() => ws.close(1008, 'join_timeout'), JOIN_TIMEOUT_MS),
    }
    clients.set(ws, client)
    console.log(`[chat] подключение, всего: ${clients.size}`)

    ws.on('pong', () => {
      client.alive = true
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) return sendError(ws, 'invalid_message')
      if (rateLimited(client)) return sendError(ws, 'rate_limited')

      let raw: unknown
      try {
        raw = JSON.parse(data.toString())
      } catch {
        return sendError(ws, 'invalid_message')
      }
      const parsed = incoming.safeParse(raw)
      if (!parsed.success) return sendError(ws, 'invalid_message')
      const msg = parsed.data

      switch (msg.type) {
        case 'join': {
          if (client.name !== null) return sendError(ws, 'already_joined')
          const name = normalizeName(msg.name)
          if (name === null) return sendError(ws, 'invalid_name')
          if (isNameTaken(name)) return sendError(ws, 'name_taken')

          client.name = name
          clearTimeout(client.joinTimer)
          send(ws, { type: 'joined', name })
          send(ws, { type: 'history', messages: history })
          send(ws, {
            type: 'system',
            message: `Добро пожаловать, ${name}!`,
            timestamp: new Date().toISOString(),
            id: randomUUID(),
          })
          broadcastUsers()
          broadcastSystem(`${name} вошёл в чат`)
          break
        }

        case 'message': {
          if (client.name === null) return sendError(ws, 'not_joined')
          const text = msg.message.trim()
          if (text === '') return
          if (text.length > MAX_TEXT) return sendError(ws, 'message_too_long')
          const entry: HistoryEntry = {
            type: 'message',
            sender: client.name,
            message: text,
            timestamp: new Date().toISOString(),
            id: randomUUID(),
          }
          history.push(entry)
          if (history.length > MAX_HISTORY) history.shift()
          broadcast(entry)
          break
        }

        case 'typing': {
          if (client.name === null) return sendError(ws, 'not_joined')
          broadcast({ type: 'typing', name: client.name, isTyping: msg.isTyping }, ws)
          break
        }

        case 'private': {
          if (client.name === null) return sendError(ws, 'not_joined')
          const text = msg.message.trim()
          if (text === '') return
          if (text.length > MAX_TEXT) return sendError(ws, 'message_too_long')
          const target = findByName(msg.to)
          if (target === null) return sendError(ws, 'user_not_found')
          if (target.ws === ws) return sendError(ws, 'pm_self')
          const entry = {
            type: 'private',
            sender: client.name,
            to: target.name,
            message: text,
            timestamp: new Date().toISOString(),
            id: randomUUID(),
          }
          // Только получателю и отправителю. В историю не попадает.
          send(target.ws, entry)
          send(ws, entry)
          break
        }
      }
    })

    ws.on('error', (e) => console.error('[chat] ошибка соединения:', e.message))

    ws.on('close', (code, reason) => {
      clearTimeout(client.joinTimer)
      clients.delete(ws)
      console.log(
        `[chat] отключение: код ${code}, причина "${reason.toString()}", осталось: ${clients.size}`,
      )
      if (client.name !== null) {
        broadcast({ type: 'typing', name: client.name, isTyping: false })
        broadcastUsers()
        broadcastSystem(`${client.name} покинул чат`)
      }
    })
  })

  // Пинг раз в 30 с: кто не ответил на предыдущий, тот потерян.
  const heartbeat = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.alive) {
        ws.terminate()
        continue
      }
      client.alive = false
      ws.ping()
    }
  }, PING_INTERVAL_MS)

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat)
        for (const ws of clients.keys()) {
          ws.close(1001, 'server_shutdown')
          setTimeout(() => ws.terminate(), 2000).unref()
        }
        wss.close(() => resolve())
      }),
  }
}