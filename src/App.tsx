import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AdminAuthProvider } from './context/AdminAuthContext'
import { PublicDataProvider } from './context/PublicDataContext'
import { CartProvider } from './context/CartContext'
import { PublicSite } from './pages/PublicSite'
import { NotFound } from './pages/NotFound'
import { Shop } from './pages/Shop'
import { ShopProduct } from './pages/ShopProduct'
import { Cart } from './pages/Cart'
import { OrderSuccess } from './pages/OrderSuccess'
import { AdminLogin } from './admin/AdminLogin'
import { AdminGuard } from './admin/AdminGuard'
import { AdminLayout } from './admin/AdminLayout'
import { AdminDashboard } from './admin/AdminDashboard'
import { AdminStands } from './admin/AdminStands'
import { AdminDesigns } from './admin/AdminDesigns'
import { AdminApprovals } from './admin/AdminApprovals'
import { AdminOrders } from './admin/AdminOrders'
import { AdminRequests } from './admin/AdminRequests'
import { AdminMessages } from './admin/AdminMessages'
import { AdminMail } from './admin/AdminMail'
import { AdminContent } from './admin/AdminContent'
import { AdminSettings } from './admin/AdminSettings'
import { AdminSandbox } from './admin/AdminSandbox'
import { BTN_POP_NAV_EVENT } from './lib/buttonPop'
import { isPortalHost } from './lib/portal'

/** Completes in-app Link navigation after the button pop animation. */
function ButtonPopNavBridge() {
  const navigate = useNavigate()
  useEffect(() => {
    const onNav = (event: Event) => {
      const to = (event as CustomEvent<{ to?: string }>).detail?.to
      if (typeof to === 'string' && to) navigate(to)
    }
    window.addEventListener(BTN_POP_NAV_EVENT, onNav)
    return () => window.removeEventListener(BTN_POP_NAV_EVENT, onNav)
  }, [navigate])
  return null
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
          <Route path="mail" element={<AdminMail />} />
          <Route path="stands" element={<AdminStands />} />
          <Route path="products" element={<Navigate to="../designs" replace />} />
          <Route path="designs" element={<AdminDesigns />} />
          <Route path="approvals" element={<AdminApprovals />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function PublicRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/:skuBase" element={<ShopProduct />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/order/success" element={<OrderSuccess />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminGuard />}>
        <Route path="sandbox" element={<AdminSandbox />} />
        <Route element={<AdminLayout />}>
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="messages" element={<AdminMessages />} />
          <Route path="mail" element={<AdminMail />} />
          <Route path="stands" element={<AdminStands />} />
          <Route path="products" element={<Navigate to="../designs" replace />} />
          <Route path="designs" element={<AdminDesigns />} />
          <Route path="approvals" element={<AdminApprovals />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="content" element={<AdminContent />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default function App() {
  const portal = isPortalHost()

  return (
    <BrowserRouter>
      <ButtonPopNavBridge />
      <PublicDataProvider>
        <CartProvider>
          <AdminAuthProvider>
            {portal ? <PortalRoutes /> : <PublicRoutes />}
          </AdminAuthProvider>
        </CartProvider>
      </PublicDataProvider>
    </BrowserRouter>
  )
}
