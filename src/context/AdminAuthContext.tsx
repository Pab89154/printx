import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { isPortalHost } from '../lib/portal'
import {
  defaultPermissions,
  type AdminPermissions,
  type PermissionKey,
} from '../../shared/permissions'

type AuthContextValue = {
  authenticated: boolean | null
  email: string | null
  displayName: string | null
  /** Name if set, otherwise email */
  label: string
  isMainAdmin: boolean
  permissions: AdminPermissions
  can: (key: PermissionKey) => boolean
  login: (email: string, password: string) => Promise<AdminPermissions>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  setDisplayName: (name: string | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function labelFor(displayName: string | null, email: string | null): string {
  return displayName?.trim() || email || 'Admin'
}

function needsAdminSession(pathname: string): boolean {
  if (isPortalHost()) return true
  if (pathname.startsWith('/admin')) return true
  // Sandbox iframe on the public host uses admin_preview + cookie
  if (new URLSearchParams(window.location.search).get('admin_preview') === '1') return true
  return false
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [displayName, setDisplayNameState] = useState<string | null>(null)
  const [isMainAdmin, setIsMainAdmin] = useState(false)
  const [permissions, setPermissions] = useState<AdminPermissions>(defaultPermissions())

  const applyMe = useCallback((me: {
    email: string
    displayName?: string | null
    isMainAdmin?: boolean
    permissions?: AdminPermissions
  }) => {
    setAuthenticated(true)
    setEmail(me.email)
    setDisplayNameState(me.displayName?.trim() || null)
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
      setDisplayNameState(null)
      setIsMainAdmin(false)
      setPermissions(defaultPermissions())
    }
  }, [applyMe])

  useEffect(() => {
    if (!needsAdminSession(location.pathname)) {
      // Public homepage: skip /api/admin/me so visitors aren't blocked on auth.
      setAuthenticated(false)
      return
    }
    setAuthenticated(null)
    void refresh()
  }, [location.pathname, refresh])

  const login = async (loginEmail: string, password: string) => {
    const result = await api.admin.login(loginEmail, password)
    applyMe(result)
    return result.permissions ?? defaultPermissions()
  }

  const logout = async () => {
    await api.admin.logout()
    setAuthenticated(false)
    setEmail(null)
    setDisplayNameState(null)
    setIsMainAdmin(false)
    setPermissions(defaultPermissions())
  }

  const can = (key: PermissionKey) => Boolean(permissions[key])
  const setDisplayName = (name: string | null) => setDisplayNameState(name?.trim() || null)

  return (
    <AuthContext.Provider
      value={{
        authenticated,
        email,
        displayName,
        label: labelFor(displayName, email),
        isMainAdmin,
        permissions,
        can,
        login,
        logout,
        refresh,
        setDisplayName,
      }}
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
