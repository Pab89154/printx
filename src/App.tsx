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
import { AdminSchools } from './admin/AdminSchools'
import { AdminContent } from './admin/AdminContent'
import { AdminSettings } from './admin/AdminSettings'

export default function App() {
  return (
    <BrowserRouter>
      <PublicDataProvider>
        <AdminAuthProvider>
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
        </AdminAuthProvider>
      </PublicDataProvider>
    </BrowserRouter>
  )
}
