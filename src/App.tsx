import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { CUSTOMER_ACCOUNTS_ENABLED } from '../shared/customerAccounts'
import { AdminAuthProvider } from './context/AdminAuthContext'
import { CustomerAuthProvider } from './context/CustomerAuthContext'
import { PublicDataProvider } from './context/PublicDataContext'
import { CartProvider } from './context/CartContext'
import { PublicSite } from './pages/PublicSite'
import { NotFound } from './pages/NotFound'
import { Shop } from './pages/Shop'
import { ShopProduct } from './pages/ShopProduct'
import { Cart } from './pages/Cart'
import { OrderSuccess } from './pages/OrderSuccess'
import { Account } from './pages/Account'
import { AccountSignIn } from './pages/AccountSignIn'
import { AccountRegister } from './pages/AccountRegister'
import { AdminDiscounts } from './admin/AdminDiscounts'
import { AdminLogin } from './admin/AdminLogin'
import { AdminGuard } from './admin/AdminGuard'
import { AdminLayout } from './admin/AdminLayout'
import { AdminDashboard } from './admin/AdminDashboard'
import { AdminStands } from './admin/AdminStands'
import { AdminDesigns } from './admin/AdminDesigns'
import { AdminApprovals } from './admin/AdminApprovals'
import { AdminOrders } from './admin/AdminOrders'
import { AdminMoney } from './admin/AdminMoney'
import { AdminRequests } from './admin/AdminRequests'
import { AdminMessages } from './admin/AdminMessages'
import { AdminMail } from './admin/AdminMail'
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
      {/* Shop lives on the public site, but sandbox Shop links are same-origin on portal — serve them here. */}
      <Route element={<AdminGuard />}>
        <Route path="shop" element={<Shop />} />
        <Route path="shop/:skuBase" element={<ShopProduct />} />
        <Route path="cart" element={<Cart />} />
        <Route path="order/success" element={<OrderSuccess />} />
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
          <Route path="discounts" element={<AdminDiscounts />} />
          <Route path="money" element={<AdminMoney />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="content" element={<Navigate to="../dashboard" replace />} />
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
      {CUSTOMER_ACCOUNTS_ENABLED ? (
        <>
          <Route path="/account" element={<Account />} />
          <Route path="/account/sign-in" element={<AccountSignIn />} />
          <Route path="/account/register" element={<AccountRegister />} />
        </>
      ) : (
        <Route path="/account/*" element={<Navigate to="/" replace />} />
      )}
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
          <Route path="discounts" element={<AdminDiscounts />} />
          <Route path="money" element={<AdminMoney />} />
          <Route path="requests" element={<AdminRequests />} />
          <Route path="content" element={<Navigate to="../dashboard" replace />} />
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
          <CustomerAuthProvider>
            <AdminAuthProvider>
              {portal ? <PortalRoutes /> : <PublicRoutes />}
            </AdminAuthProvider>
          </CustomerAuthProvider>
        </CartProvider>
      </PublicDataProvider>
    </BrowserRouter>
  )
}
