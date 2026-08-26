import { Navigate, Outlet } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext'

export function AdminGuard() {
  const { authenticated } = useAdminAuth()

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-muted">Checking authentication…</p>
      </div>
    )
  }

  if (!authenticated) return <Navigate to="/admin" replace />

  return <Outlet />
}
