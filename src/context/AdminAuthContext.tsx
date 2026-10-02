import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'
import {
  defaultPermissions,
  type AdminPermissions,
  type PermissionKey,
} from '../../shared/permissions'

type AuthContextValue = {
  authenticated: boolean | null
  email: string | null
  isMainAdmin: boolean
  permissions: AdminPermissions
  can: (key: PermissionKey) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [permissions, setPermissions] = useState<AdminPermissions>(defaultPermissions())

  const applyMe = useCallback((me: {
    email: string
    isMainAdmin?: boolean
    permissions?: AdminPermissions
  }) => {
    setAuthenticated(true)
    setEmail(me.email)
    setIsMainAdmin(Boolean(me.isMainAdmin))
    setPermissions(me.permissions ?? defaultPermissions())
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await api.admin.me()
      applyMe(me)
    } catch {
      setAuthenticated(false)
      setEmail(null)
      setIsMainAdmin(false)
      setPermissions(defaultPermissions())
    }
  }, [applyMe])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = async (loginEmail: string, password: string) => {
    const result = await api.admin.login(loginEmail, password)
    applyMe(result)
  }

  const logout = async () => {
    await api.admin.logout()
    setAuthenticated(false)
    setEmail(null)
    setIsMainAdmin(false)
    setPermissions(defaultPermissions())
  }

  const can = (key: PermissionKey) => Boolean(permissions[key])

  return (
    <AuthContext.Provider
      value={{ authenticated, email, isMainAdmin, permissions, can, login, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAdminAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
