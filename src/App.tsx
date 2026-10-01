import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminAuthProvider } from './context/AdminAuthContext'
import { PublicDataProvider } from './context/PublicDataContext'
import { PublicSite } from './pages/PublicSite'
import { AdminLogin } from './admin/AdminLogin'
import { AdminGuard } from './admin/AdminGuard'
import { AdminLayout } from './admin/AdminLayout'
import { AdminDashboard } from './admin/AdminDashboard'
import { AdminStands } from './admin/AdminStands'
import { AdminProducts } from './admin/AdminProducts'
import { AdminRequests } from './admin/AdminRequests'
import { AdminSchools } from './admin/AdminSchools'
import { AdminContent } from './admin/AdminContent'
import { AdminSettings } from './admin/AdminSettings'
import { isPortalHost, portalUrl } from './lib/portal'

function PortalRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AdminLogin />} />
      <Route element={<AdminGuard />}>
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="stands" element={<AdminStands />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="schools" element={<AdminSchools />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function LocalAdminRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminGuard />}>
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="stands" element={<AdminStands />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="schools" element={<AdminSchools />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** On printx.pw, send /admin… to portal.printx.pw */
function AdminToPortalRedirect() {
  const location = useLocation()

  useEffect(() => {
    const rest = location.pathname.replace(/^\/admin/, '') || '/'
    const search = location.search || ''
    window.location.replace(`${portalUrl(rest)}${search}`)
  }, [location.pathname, location.search])

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <p className="text-muted">Redirecting to admin portal…</p>
    </div>
  )
}

function ProductionPublicRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/admin/*" element={<AdminToPortalRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const portal = isPortalHost()
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isLocal = host === 'localhost' || host === '127.0.0.1'

  return (
    <BrowserRouter>
      <PublicDataProvider>
        <AdminAuthProvider>
          {portal ? (
            <PortalRoutes />
          ) : isLocal ? (
            <LocalAdminRoutes />
          ) : (
            <ProductionPublicRoutes />
          )}
        </AdminAuthProvider>
      </PublicDataProvider>
    </BrowserRouter>
  )
}
