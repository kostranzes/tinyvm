import { createContext, useContext } from 'react'
import type { User } from '../api'

export interface AuthValue {
  user: User | null
  // true, пока идёт первая проверка /api/auth/me
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth нужно вызывать внутри AuthProvider')
  }
  return value
}