import { usePublicData } from '../context/PublicDataContext'
import { ABOUT_VALUES } from '../data/products'
import { WebIcon } from '../lib/webIcon'
import { ScrollReveal } from './ScrollReveal'

export function About() {
  const { data } = usePublicData()
  const content = data?.content

  return (
    <section id="about" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <ScrollReveal>
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200">
              <div className="absolute inset-0 flex items-center justify-center">
                <WebIcon name="printer-3d" className="h-20 w-20 opacity-40" alt="3D printer" />
              </div>
              <div className="absolute inset-0 filament-pattern opacity-30" />
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">More Than Just 3D Printing.</h2>
            <p className="mt-6 text-lg leading-relaxed text-muted">{content?.aboutText}</p>
            <p className="mt-4 leading-relaxed text-muted">{content?.aboutTeam}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {ABOUT_VALUES.map((value) => (
                <span key={value} className="rounded-full border border-electric/20 bg-electric/5 px-3.5 py-1.5 text-sm font-medium text-electric">{value}</span>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  )
}
