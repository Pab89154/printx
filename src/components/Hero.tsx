import { MapPin } from 'lucide-react'
import { Button } from './Button'
import { WebIcon } from '../lib/webIcon'
import { usePublicData } from '../context/PublicDataContext'

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      <div className="relative aspect-square overflow-hidden rounded-3xl bg-gradient-to-br from-navy via-navy-light to-electric p-8 shadow-2xl shadow-navy/30">
        <div className="absolute inset-0 filament-pattern opacity-40" />
        <div className="animate-float absolute left-8 top-12 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan to-cyan-light shadow-lg">
          <WebIcon name="loader" light className="h-10 w-10" alt="" />
        </div>
        <div className="animate-float absolute right-10 top-20 flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-electric-light to-electric shadow-lg" style={{ animationDelay: '0.5s' }}>
          <WebIcon name="key-round" light className="h-8 w-8" alt="" />
        </div>
        <div className="animate-float absolute bottom-24 left-16 flex h-14 w-14 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm" style={{ animationDelay: '1s' }}>
          <WebIcon name="smartphone" light className="h-7 w-7" alt="" />
        </div>
        <div className="animate-float absolute bottom-16 right-12 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-lg" style={{ animationDelay: '1.5s' }}>
          <WebIcon name="folder-open" light className="h-12 w-12" alt="" />
        </div>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex h-32 w-32 items-center justify-center rounded-lg border-2 border-white/30 bg-white/10 backdrop-blur-sm">
            <WebIcon name="printer" light className="h-14 w-14" alt="3D printer" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  const { data } = usePublicData()
  const content = data?.content

  return (
    <section id="home" className="relative overflow-hidden bg-white pt-12 pb-20 sm:pt-16 sm:pb-28">
      {data?.announcementActive && content?.announcementText && (
        <div className="relative bg-gradient-to-r from-electric to-cyan px-4 py-3 text-center text-sm font-semibold text-white">
          {content.announcementText}
        </div>
      )}

      <div className="absolute inset-0 filament-pattern opacity-50" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-8 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <div className="animate-fade-up">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 shadow-sm">
            <MapPin size={14} className="text-electric" />
            McKinney, TX
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-navy sm:text-5xl lg:text-6xl">
            {content?.heroHeadline ?? 'Your Ideas. Our Prints.'}
          </h1>

          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
            {content?.heroDescription}
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Button href="#products" size="lg">See Our Products</Button>
            <Button href="#stands" variant="secondary" size="lg">Find Our Next Stand</Button>
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  )
}
