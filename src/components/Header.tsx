import { useState } from 'react'
import { Menu, X, Layers3 } from 'lucide-react'
import { NAV_LINKS } from '../data/navigation'
import { Button } from './Button'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-slate-100/80 bg-white/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a href="#home" className="group flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-electric to-cyan text-white shadow-md shadow-electric/30">
            <Layers3 size={20} strokeWidth={2.5} />
          </div>
          <div className="hidden sm:block">
            <div className="text-lg font-extrabold tracking-tight text-navy">PrintX</div>
            <div className="text-xs font-medium text-muted">3D Printing • McKinney, TX</div>
          </div>
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-electric"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button href="#stands" size="sm" className="hidden sm:inline-flex">
            Find a Stand
          </Button>
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
        <nav className="border-t border-slate-100 bg-white px-4 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-electric"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <Button href="#stands" size="md" className="mt-2 w-full">
              Find a Stand
            </Button>
          </div>
        </nav>
      )}
    </header>
  )
}
