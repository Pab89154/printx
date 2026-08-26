import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { PublicBootstrap } from '../types/api'

type PublicDataContextValue = {
  data: PublicBootstrap | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const PublicDataContext = createContext<PublicDataContextValue | null>(null)

export function PublicDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PublicBootstrap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const bootstrap = await api.public.bootstrap()
      setData(bootstrap)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load site data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
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
