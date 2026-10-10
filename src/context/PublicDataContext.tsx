import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { isPortalHost } from '../lib/portal'
import type { PublicBootstrap } from '../types/api'

type PublicDataContextValue = {
  data: PublicBootstrap | null
  loading: boolean
  error: string | null
  refresh: (opts?: { full?: boolean }) => Promise<void>
}

const PublicDataContext = createContext<PublicDataContextValue | null>(null)

function needsPublicBootstrap(pathname: string): boolean {
  // Portal admin pages don't need the public catalog — only the sandbox preview does.
  if (isPortalHost()) return pathname.includes('sandbox')
  return true
}

/** Full catalog (stands/products) even when the public site is paused. */
function shouldFetchFull(forced?: boolean): boolean {
  if (forced) return true
  if (typeof window === 'undefined') return false
  if (isPortalHost()) return true
  if (window.location.pathname.includes('/sandbox')) return true
  if (new URLSearchParams(window.location.search).get('admin_preview') === '1') return true
  return false
}

export function PublicDataProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const wantsData = needsPublicBootstrap(location.pathname)
  const [data, setData] = useState<PublicBootstrap | null>(null)
  const [loading, setLoading] = useState(() =>
    typeof window !== 'undefined' ? needsPublicBootstrap(window.location.pathname) : true,
  )
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { full?: boolean }) => {
    setError(null)
    setLoading(true)
    const full = shouldFetchFull(opts?.full)
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const bootstrap = await api.public.bootstrap({ full })
        setData(bootstrap)
        setLoading(false)
        return
      } catch (e) {
        lastError = e
        // Transient DB pool saturation after server restarts
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
    setError(lastError instanceof Error ? lastError.message : 'Failed to load site data')
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!wantsData) {
      setLoading(false)
      return
    }
    void refresh()
  }, [wantsData, refresh])

  return (
    <PublicDataContext.Provider value={{ data, loading, error, refresh }}>
      {children}
    </PublicDataContext.Provider>
  )
}

export function usePublicData() {
  const ctx = useContext(PublicDataContext)
  if (!ctx) throw new Error('usePublicData must be used within PublicDataProvider')
  return ctx
}
