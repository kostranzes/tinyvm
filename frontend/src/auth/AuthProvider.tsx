import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { User } from '../api'
import { AuthContext } from './auth-context'
import type { AuthValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Один раз при старте: есть ли живая сессия (кука tinyvm_sid).
  // 401 или недоступный сервер означают «не вошли».
  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((r) => {
        if (!cancelled) setUser(r.user)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      login: async (email, password) => {
        const r = await api.login(email, password)
        setUser(r.user)
      },
      register: async (email, password) => {
        const r = await api.register(email, password)
        setUser(r.user)
      },
      logout: async () => {
        await api.logout()
        setUser(null)
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}