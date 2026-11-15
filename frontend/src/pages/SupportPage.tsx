import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { useChat } from '../chat/useChat'

const MAX_NAME = 24
const MAX_TEXT = 1000

// Имя по умолчанию: часть email до «@».
function defaultName(email: string | undefined): string {
  if (!email) return ''
  return email.split('@')[0].slice(0, MAX_NAME)
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU')
}

function typingText(names: string[]): string {
  if (names.length === 0) return ''
  return names.length === 1 ? `${names[0]} печатает…` : `${names.join(', ')} печатают…`
}

const STATUS_TEXT = {
  idle: 'Не подключён',
  connecting: 'Подключение…',
  online: 'Подключён',
  offline: 'Отключён',
} as const

export function SupportPage() {
  const { user } = useAuth()
  const chat = useChat()
  const [nameInput, setNameInput] = useState(() => defaultName(user?.email))
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const { messages } = chat

  // Новые сообщения: прокрутка вниз.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const inChat = chat.status === 'online' || chat.status === 'offline'

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    chat.join(nameInput)
  }

  function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (chat.send(text)) setText('')
  }

  function handleInput(value: string) {
    setText(value)
    chat.notifyTyping(value.trim() !== '')
  }

  if (!inChat) {
    return (
      <div className="card">
        <h1>Служба поддержки</h1>
        <form className="form" onSubmit={handleJoin}>
          <label>
            Ваше имя в чате
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={MAX_NAME}
              autoFocus
              required
            />
          </label>
          {!user && (
            <span className="muted">
              Вы не вошли в аккаунт. <Link to="/login">Войти</Link>, чтобы имя подставлялось
              автоматически.
            </span>
          )}
          {chat.error && <p className="error">{chat.error}</p>}
          <button type="submit" disabled={chat.status === 'connecting'}>
            {chat.status === 'connecting' ? 'Подключение…' : 'Войти в чат'}
          </button>
        </form>
      </div>
    )
  }

  const online = chat.status === 'online'

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="chat-title">Служба поддержки</span>
        <span className="muted">Вы: {chat.name}</span>
        <span className={online ? 'chat-status online' : 'chat-status offline'}>
          {STATUS_TEXT[chat.status]}
        </span>
        <span className="toolbar-spacer" />
        {!online && (
          <button type="button" onClick={() => chat.join(chat.name ?? nameInput)}>
            Подключиться заново
          </button>
        )}
        <button type="button" className="secondary" onClick={chat.leave}>
          Выйти из чата
        </button>
      </div>

      <div className="chat-messages" ref={listRef}>
        {messages.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="chat-msg system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={m.sender === chat.name ? 'chat-msg self' : 'chat-msg other'}>
              <div className="chat-meta">
                <span className="chat-sender">{m.sender}</span>
                <span>{formatTime(m.timestamp)}</span>
              </div>
              <div className="chat-text">{m.text}</div>
            </div>
          ),
        )}
      </div>

      <div className="chat-typing">{typingText(chat.typing)}</div>
      {chat.error && <p className="error chat-error">{chat.error}</p>}

      <form className="chat-input" onSubmit={handleSend}>
        <input
          value={text}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Введите сообщение…"
          maxLength={MAX_TEXT}
          disabled={!online}
          autoFocus
        />
        <button type="submit" disabled={!online}>
          Отправить
        </button>
      </form>
    </div>
  )
}