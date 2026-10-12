import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../lib/api'

type Customer = {
  id: string
  email: string
  displayName: string | null
}

type CustomerAuthValue = {
  customer: Customer | null
  loading: boolean
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const CustomerAuthContext = createContext<CustomerAuthValue | null>(null)

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const data = await api.customer.me()
      setCustomer(data.customer)
    } catch {
      // 401/404 are normal when signed out or before deploy — never surface as UI errors.
      setCustomer(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.customer.login(email, password)
    setCustomer(data.customer)
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const data = await api.customer.register(name, email, password)
    setCustomer(data.customer)
  }, [])

  const logout = useCallback(async () => {
    await api.customer.logout()
    setCustomer(null)
  }, [])

  return (
    <CustomerAuthContext.Provider
      value={{ customer, loading, refresh, login, register, logout }}
    >
      {children}
    </CustomerAuthContext.Provider>
  )
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext)
  if (!ctx) throw new Error('useCustomerAuth requires CustomerAuthProvider')
  return ctx
}
