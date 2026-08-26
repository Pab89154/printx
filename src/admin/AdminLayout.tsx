import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Building2,
  FileText,
  LayoutDashboard,
  Layers3,
  LogOut,
  MapPin,
  Package,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'

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

  async function handleLogout() {
    await logout()
    navigate('/admin')
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-navy text-white">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-electric to-cyan">
            <Layers3 size={18} />
          </div>
          <div>
            <div className="font-bold">PrintX Admin</div>
            <div className="text-xs text-slate-400">Dashboard</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-electric text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <a href="/" className="mb-2 block rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/10 hover:text-white">
            ← View Public Site
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className="ml-64 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  )
}
