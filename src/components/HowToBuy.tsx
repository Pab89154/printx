import { Footprints, HandCoins, MapPin } from 'lucide-react'
import { HOW_TO_BUY } from '../data/products'
import { usePublicData } from '../context/PublicDataContext'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const iconMap = {
  'map-pin': MapPin,
  footprints: Footprints,
  'hand-coins': HandCoins,
} as const

export function HowToBuy() {
  const { data } = usePublicData()
  const hasStands = (data?.stands?.length ?? 0) > 0
  if (!hasStands) return null

  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading title="How to Buy" subtitle="Getting a PrintX product is easy — just show up!" />
        </ScrollReveal>

        <div className="grid items-stretch gap-8 py-1 md:grid-cols-3">
          {HOW_TO_BUY.map((step, i) => {
            const Icon = iconMap[step.icon]
            return (
              <ScrollReveal key={step.step} delay={i * 120} className="h-full">
                <div
                  className={`group flex h-full select-none flex-col rounded-2xl border bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${step.className}`}
                >
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-electric to-cyan text-white shadow-lg shadow-electric/25 transition-all duration-300 group-hover:from-white/25 group-hover:to-white/10 group-hover:shadow-md group-hover:scale-105">
                    <Icon size={28} strokeWidth={2} />
                  </div>
                  <div className="mb-2 text-sm font-bold uppercase tracking-wider text-electric transition-colors duration-150 group-hover:text-white/90">
                    Step {step.step}
                  </div>
                  <h3 className="text-xl font-bold text-navy transition-colors duration-150 group-hover:text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted transition-colors duration-150 group-hover:text-white/90">
                    {step.description}
                  </p>
                </div>
              </ScrollReveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
