import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'

type AuthContextValue = {
  authenticated: boolean | null
  email: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  const check = useCallback(async () => {
    try {
      const me = await api.admin.me()
      setAuthenticated(true)
      setEmail(me.email)
    } catch {
      setAuthenticated(false)
      setEmail(null)
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const login = async (loginEmail: string, password: string) => {
    const result = await api.admin.login(loginEmail, password)
    setAuthenticated(true)
    setEmail(result.email)
  }

  const logout = async () => {
    await api.admin.logout()
    setAuthenticated(false)
    setEmail(null)
  }

  return (
    <AuthContext.Provider value={{ authenticated, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
