import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { AdminMessages } from './admin/AdminMessages'
import { AdminSchools } from './admin/AdminSchools'
import { AdminContent } from './admin/AdminContent'
import { AdminSettings } from './admin/AdminSettings'
import { AdminSandbox } from './admin/AdminSandbox'
import { useAdminAuth } from './context/AdminAuthContext'
import { firstAllowedAdminPath, isPortalHost } from './lib/portal'

function AdminHomeRedirect() {
  const { permissions } = useAdminAuth()
  return <Navigate to={firstAllowedAdminPath(permissions)} replace />
}

function PortalRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AdminLogin />} />
      <Route element={<AdminGuard />}>
        <Route path="sandbox" element={<AdminSandbox />} />
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="messages" element={<AdminMessages />} />
          <Route path="stands" element={<AdminStands />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="schools" element={<AdminSchools />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<AdminHomeRedirect />} />
    </Routes>
  )
}

/** Public site + /admin on printx.pw (and localhost). No redirect to portal. */
function PublicRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminGuard />}>
        <Route path="sandbox" element={<AdminSandbox />} />
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="messages" element={<AdminMessages />} />
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

export default function App() {
  const portal = isPortalHost()

  return (
    <BrowserRouter>
      <PublicDataProvider>
        <AdminAuthProvider>
          {portal ? <PortalRoutes /> : <PublicRoutes />}
        </AdminAuthProvider>
      </PublicDataProvider>
    </BrowserRouter>
  )
}
