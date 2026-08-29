import { Logo } from './Logo'

export function SitePausedScreen() {
  return (
    <div className="brand-panel relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center text-white">
      <div className="absolute inset-0 filament-pattern opacity-30" />
      <div className="relative flex flex-col items-center">
        <Logo size={88} className="mb-8 shadow-2xl shadow-navy/50" />
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan">PrintX</p>
        <h1 className="mt-4 max-w-xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          Currently Planning Prints!
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-slate-300 sm:text-lg">
          We&apos;ll be back soon with new products and stand dates. Thanks for your patience.
        </p>
      </div>
    </div>
  )
}
