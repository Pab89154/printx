import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Printer,
  Settings,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react'
import { useAdminAuth } from '../context/AdminAuthContext'
import { Logo } from '../components/Logo'
import { useMailUnread } from '../hooks/useMailUnread'
import { SandboxIcon } from '../lib/sandboxIcon'
import { adminHomePath, adminPath, firstAllowedAdminPath, publicSiteUrl } from '../lib/portal'
import type { PermissionKey } from '../../shared/permissions'

const links: {
  section: string
  label: string
  icon: typeof LayoutDashboard
  perm: PermissionKey | 'main_only'
}[] = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard' },
  { section: 'messages', label: 'Inbox', icon: Inbox, perm: 'messages' },
  { section: 'mail', label: 'Mail', icon: Mail, perm: 'mail' },
  { section: 'stands', label: 'Stands', icon: MapPin, perm: 'stands' },
  { section: 'designs', label: 'Designs', icon: Printer, perm: 'products' },
  { section: 'approvals', label: 'Approvals & Pricing', icon: ClipboardCheck, perm: 'main_only' },
  { section: 'orders', label: 'Orders', icon: ShoppingBag, perm: 'orders' },
  { section: 'requests', label: 'Custom Requests', icon: Sparkles, perm: 'requests' },
  { section: 'content', label: 'Website Content', icon: FileText, perm: 'content' },
  { section: 'settings', label: 'Settings', icon: Settings, perm: 'settings' },
]

export function AdminLayout() {
  const { logout, can, isMainAdmin, label, permissions } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { unreadCount, ensureMailNotificationPermission } = useMailUnread(can('mail'))

  const allowedLinks = links.filter((l) =>
    l.perm === 'main_only' ? isMainAdmin : can(l.perm),
  )
  const navLinks = allowedLinks.map((l) => ({ ...l, to: adminPath(l.section) }))
  const currentLabel = navLinks.find((l) => location.pathname.startsWith(l.to))?.label ?? 'Admin'
  const mailBadge =
    unreadCount > 0 ? (unreadCount > 99 ? '99+' : String(unreadCount)) : null
  const onMailPage = location.pathname.startsWith(adminPath('mail'))

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

  // Redirect away from sections the admin cannot see
  useEffect(() => {
    const section = location.pathname.replace(/^\/admin\/?/, '').replace(/^\//, '').split('/')[0]
    if (!section) return
    const fallback = firstAllowedAdminPath(permissions)
    if (section === 'sandbox') {
      if (!permissions.sandbox) navigate(fallback, { replace: true })
      return
    }
    const link = links.find((l) => l.section === section)
    if (!link) return
    if (link.perm === 'main_only') {
      if (!isMainAdmin) navigate(fallback, { replace: true })
      return
    }
    if (!permissions[link.perm]) navigate(fallback, { replace: true })
  }, [location.pathname, permissions, navigate, isMainAdmin])

  async function handleLogout() {
    await logout()
    navigate(adminHomePath())
  }

  return (
    <div className="flex min-h-dvh max-w-[100vw] bg-slate-50">
      <header className="fixed inset-x-0 top-0 z-40 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-navy px-4 pb-0 pt-[env(safe-area-inset-top,0px)] text-white md:hidden">
        <div className="flex h-14 w-full min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="shrink-0 rounded-lg p-2 hover:bg-white/10"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Logo size={28} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">PrintX Admin</div>
              <div className="truncate text-xs text-slate-400">{currentLabel}</div>
            </div>
          </div>
          {mailBadge && !onMailPage && can('mail') ? (
            <button
              type="button"
              className="relative shrink-0 rounded-lg p-2 hover:bg-white/10"
              aria-label={`${unreadCount} unread mail`}
              onClick={() => {
                ensureMailNotificationPermission()
                navigate(adminPath('mail'))
              }}
            >
              <Mail size={20} />
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                {mailBadge}
              </span>
            </button>
          ) : null}
        </div>
      </header>

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
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5 sm:px-5">
          <Logo size={36} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">PrintX Admin</div>
            <div className="truncate text-xs text-slate-300">{label}</div>
            <div className="truncate text-[11px] text-slate-400">
              {isMainAdmin ? 'Main admin' : 'Admin'}
            </div>
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
          {navLinks.map(({ to, label, icon: Icon, section }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => {
                if (section === 'mail') ensureMailNotificationPermission()
              }}
              className={({ isActive }) =>
                `press-pop flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors md:py-2.5 ${
                  isActive ? 'bg-electric text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon size={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {section === 'mail' && mailBadge ? (
                <span
                  className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white"
                  aria-label={`${unreadCount} unread`}
                >
                  {mailBadge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          {can('sandbox') && (
            <NavLink
              to={adminPath('sandbox')}
              className="press-pop mb-1 flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-amber-200 hover:bg-white/10 hover:text-white md:py-2.5"
            >
              <SandboxIcon size={18} className="shrink-0 text-amber-400" />
              Site sandbox
            </NavLink>
          )}
          <a
            href={publicSiteUrl('/')}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-2 block rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/10 hover:text-white"
          >
            Open public site ↗
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="btn flex w-full items-center gap-3 !justify-start !rounded-xl !border-0 !bg-transparent px-3 py-3 text-sm font-medium !text-slate-300 hover:!bg-white/10 hover:!text-white md:py-2.5"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className="min-w-0 max-w-full flex-1 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top,0px)+0.75rem)] md:ml-64 md:p-8 md:pt-8">
        <div className="mx-auto w-full min-w-0 max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
