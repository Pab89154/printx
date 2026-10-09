import { Link, useLocation } from 'react-router-dom'
import { Logo } from '../components/Logo'

export function NotFound() {
  const { pathname } = useLocation()

  return (
    <div className="brand-panel relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center text-white">
      <div className="absolute inset-0 filament-pattern opacity-30" />
      <div className="relative flex flex-col items-center animate-fade-up">
        <Logo size={88} className="mb-8 shadow-2xl shadow-navy/50" />
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan">PrintX</p>
        <p className="mt-6 text-7xl font-extrabold tracking-tight text-white/90 sm:text-8xl">404</p>
        <h1 className="mt-3 max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
          Page not found
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
          That link doesn&apos;t lead anywhere on PrintX.
          {pathname && pathname !== '/' ? (
            <>
              {' '}
              <span className="break-all text-slate-400">({pathname})</span>
            </>
          ) : null}
        </p>
        <Link to="/" className="btn btn-primary mt-8 !min-h-11 !px-8 !text-sm">
          Back to PrintX
        </Link>
      </div>
    </div>
  )
}
