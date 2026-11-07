import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { describeError } from '../api'
import { useAuth } from '../auth/auth-context'

// Одна страница на вход и регистрацию: формы почти одинаковые.
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const isLogin = mode === 'login'

  // Уже вошли: на этой странице делать нечего.
  if (user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await (isLogin ? login : register)(email, password)
      navigate('/')
    } catch (e) {
      setError(describeError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="card">
      <h1>{isLogin ? 'Вход' : 'Регистрация'}</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            minLength={isLogin ? undefined : 10}
            maxLength={128}
            required
          />
        </label>
        {!isLogin && <span className="muted">От 10 до 128 символов.</span>}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? 'Подождите…' : isLogin ? 'Войти' : 'Зарегистрироваться'}
        </button>
      </form>
      <p className="muted">
        {isLogin ? (
          <>
            Нет аккаунта? <Link to="/register">Регистрация</Link>
          </>
        ) : (
          <>
            Уже есть аккаунт? <Link to="/login">Войти</Link>
          </>
        )}
      </p>
    </div>
  )
}