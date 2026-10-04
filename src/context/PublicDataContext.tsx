import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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
  const [data, setData] = useState<PublicBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { full?: boolean }) => {
    try {
      setError(null)
      const bootstrap = await api.public.bootstrap({ full: shouldFetchFull(opts?.full) })
      setData(bootstrap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load site data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
