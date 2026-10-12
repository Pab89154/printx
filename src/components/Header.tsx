import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, User, X } from 'lucide-react'
import { NAV_LINKS } from '../data/navigation'
import { usePublicData } from '../context/PublicDataContext'
import { useCustomerAuth } from '../context/CustomerAuthContext'
import { onHashLinkClick } from '../lib/scroll'
import { Button } from './Button'
import { Logo } from './Logo'
import { CartLink } from './CartLink'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { data } = usePublicData()
  const { customer } = useCustomerAuth()
  const hasStands = (data?.stands?.length ?? 0) > 0
  const links = NAV_LINKS.filter((link) => link.href !== '#stands' || hasStands)
  const accountHref = customer ? '/account' : '/account/sign-in'

  return (
    <header className="sticky top-0 z-50 border-b border-navy/8 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a
          href="#home"
          className="group flex items-center gap-3"
          onClick={(e) => onHashLinkClick(e, '#home')}
        >
          <Logo size={40} className="transition-opacity group-hover:opacity-90" />
          <span className="hidden min-w-0 sm:block">
            <span className="block text-lg font-extrabold tracking-tight leading-none text-navy">PrintX</span>
            <span className="mt-0.5 block text-xs font-medium text-muted">3D Printing • DFW Area</span>
          </span>
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-electric"
              onClick={(e) => onHashLinkClick(e, link.href)}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <CartLink />
          <Link
            to={accountHref}
            aria-label={customer ? 'Account' : 'Sign in'}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-navy transition hover:bg-slate-100"
          >
            <User size={20} strokeWidth={2} aria-hidden />
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            className="rounded-xl p-2.5 text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-navy/8 bg-white px-4 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-electric"
                onClick={(e) => {
                  onHashLinkClick(e, link.href)
                  setMenuOpen(false)
                }}
              >
                {link.label}
              </a>
            ))}
            <Link
              to={accountHref}
              className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-electric"
              onClick={() => setMenuOpen(false)}
            >
              {customer ? 'My account' : 'Sign in'}
            </Link>
            {hasStands ? (
              <Button href="#stands" size="md" className="mt-2 w-full">
                Find a Stand
              </Button>
            ) : (
              <Button href={accountHref} size="md" className="mt-2 w-full">
                {customer ? 'My account' : 'Sign in'}
              </Button>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}
