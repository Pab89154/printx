import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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

const ME_CACHE_KEY = 'printx_admin_me_v1'

type CachedMe = {
  email: string
  displayName: string | null
  isMainAdmin: boolean
  permissions: AdminPermissions
}

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
  if (new URLSearchParams(window.location.search).get('admin_preview') === '1') return true
  return false
}

function readMeCache(): CachedMe | null {
  try {
    const raw = sessionStorage.getItem(ME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedMe
    if (!parsed?.email || !parsed.permissions) return null
    return parsed
  } catch {
    return null
  }
}

function writeMeCache(me: CachedMe) {
  try {
    sessionStorage.setItem(ME_CACHE_KEY, JSON.stringify(me))
  } catch {
    /* ignore quota / private mode */
  }
}

function clearMeCache() {
  try {
    sessionStorage.removeItem(ME_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const needsSession = needsAdminSession(location.pathname)
  const checkedRef = useRef(false)
  const [authenticated, setAuthenticated] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null
    if (!needsAdminSession(window.location.pathname)) return false
    return readMeCache() ? true : null
  })
  const [email, setEmail] = useState<string | null>(() => readMeCache()?.email ?? null)
  const [displayName, setDisplayNameState] = useState<string | null>(
    () => readMeCache()?.displayName ?? null,
  )
  const [isMainAdmin, setIsMainAdmin] = useState(() => Boolean(readMeCache()?.isMainAdmin))
  const [permissions, setPermissions] = useState<AdminPermissions>(
    () => readMeCache()?.permissions ?? defaultPermissions(),
  )

  const applyMe = useCallback((me: {
    email: string
    displayName?: string | null
    isMainAdmin?: boolean
    permissions?: AdminPermissions
  }) => {
    const next: CachedMe = {
      email: me.email,
      displayName: me.displayName?.trim() || null,
      isMainAdmin: Boolean(me.isMainAdmin),
      permissions: me.permissions ?? defaultPermissions(),
    }
    setAuthenticated(true)
    setEmail(next.email)
    setDisplayNameState(next.displayName)
    setIsMainAdmin(next.isMainAdmin)
    setPermissions(next.permissions)
    writeMeCache(next)
    checkedRef.current = true
  }, [])

  const clearAuth = useCallback(() => {
    setAuthenticated(false)
    setEmail(null)
    setDisplayNameState(null)
    setIsMainAdmin(false)
    setPermissions(defaultPermissions())
    clearMeCache()
    checkedRef.current = true
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await api.admin.me()
      applyMe(me)
    } catch {
      clearAuth()
    }
  }, [applyMe, clearAuth])

  useEffect(() => {
    if (!needsSession) {
      // Public pages on printx.pw: skip auth work entirely.
      if (authenticated === null) setAuthenticated(false)
      return
    }

    // Already resolved for this browser session — don't flash "Checking…" on every route.
    if (checkedRef.current && authenticated !== null) return

    let cancelled = false
    ;(async () => {
      try {
        const me = await api.admin.me()
        if (!cancelled) applyMe(me)
      } catch {
        if (!cancelled) clearAuth()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [needsSession, authenticated, applyMe, clearAuth])

  const login = async (loginEmail: string, password: string) => {
    const result = await api.admin.login(loginEmail, password)
    applyMe(result)
    return result.permissions ?? defaultPermissions()
  }

  const logout = async () => {
    try {
      await api.admin.logout()
    } finally {
      clearAuth()
    }
  }

  const can = (key: PermissionKey) => Boolean(permissions[key])
  const setDisplayName = (name: string | null) => {
    const next = name?.trim() || null
    setDisplayNameState(next)
    const cached = readMeCache()
    if (cached) writeMeCache({ ...cached, displayName: next })
  }

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
