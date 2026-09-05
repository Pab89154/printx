import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { Logo } from '../components/Logo'

const links = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/stands', label: 'Stands', icon: MapPin },
  { to: '/admin/products', label: 'Products', icon: Package },
  { to: '/admin/requests', label: 'Custom Requests', icon: Sparkles },
  { to: '/admin/schools', label: 'Schools', icon: Building2 },
  { to: '/admin/content', label: 'Website Content', icon: FileText },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export function AdminLayout() {
  const { logout } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [menuOpen])

  async function handleLogout() {
    await logout()
    navigate('/admin')
  }

  const currentLabel = links.find((l) => location.pathname.startsWith(l.to))?.label ?? 'Admin'

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-navy px-4 pb-0 pt-[env(safe-area-inset-top,0px)] text-white md:hidden">
        <div className="flex h-14 w-full items-center gap-3">
        <button
          type="button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="rounded-lg p-2 hover:bg-white/10"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <Logo size={28} />
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">PrintX Admin</div>
            <div className="truncate text-xs text-slate-400">{currentLabel}</div>
          </div>
        </div>
        </div>
      </header>

      {/* Backdrop */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-navy/50 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col border-r border-slate-200 bg-navy text-white transition-transform duration-200 safe-top safe-bottom md:w-64 md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <Logo size={36} />
          <div>
            <div className="font-bold">PrintX Admin</div>
            <div className="text-xs text-slate-400">Dashboard</div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="ml-auto rounded-lg p-2 text-slate-300 hover:bg-white/10 md:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors md:py-2.5 ${
                  isActive ? 'bg-electric text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <a
            href="/"
            className="mb-2 block rounded-xl px-3 py-3 text-sm text-slate-400 hover:bg-white/10 hover:text-white md:py-2"
          >
            ← View Public Site
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white md:py-2.5"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top,0px)+0.75rem)] md:ml-64 md:p-8 md:pt-8">
        <Outlet />
      </main>
    </div>
  )
}
