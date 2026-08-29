import { Logo } from './Logo'

export function SitePausedScreen() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-navy via-navy-light to-electric px-6 text-center text-white">
      <div className="absolute inset-0 filament-pattern opacity-30" />
      <div className="relative flex flex-col items-center">
        <Logo size={88} className="mb-8 shadow-2xl shadow-black/30" />
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-light">PrintX</p>
        <h1 className="mt-4 max-w-xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          Currently Planning Prints!
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
          We&apos;ll be back soon with new products and stand dates. Thanks for your patience.
        </p>
        <a
          href="/admin"
          className="mt-10 text-sm font-medium text-slate-400 underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Admin sign in
        </a>
      </div>
    </div>
  )
}
