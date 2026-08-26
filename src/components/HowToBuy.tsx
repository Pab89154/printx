import { Footprints, HandCoins, MapPin } from 'lucide-react'
import { HOW_TO_BUY } from '../data/products'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const iconMap = {
  'map-pin': MapPin,
  footprints: Footprints,
  'hand-coins': HandCoins,
} as const

export function HowToBuy() {
  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading title="How to Buy" subtitle="Getting a PrintX product is easy — just show up!" />
        </ScrollReveal>

        <div className="grid gap-8 md:grid-cols-3">
          {HOW_TO_BUY.map((step, i) => {
            const Icon = iconMap[step.icon]
            return (
              <ScrollReveal key={step.step} delay={i * 120}>
                <div className="relative rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  {i < HOW_TO_BUY.length - 1 && (
                    <div className="absolute left-[60%] top-12 hidden h-0.5 w-[80%] bg-gradient-to-r from-electric/30 to-transparent md:block" />
                  )}
                  <div className="mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-electric to-cyan text-white shadow-lg shadow-electric/25">
                    <Icon size={28} strokeWidth={2} />
                  </div>
                  <div className="mb-2 text-sm font-bold uppercase tracking-wider text-electric">
                    Step {step.step}
                  </div>
                  <h3 className="text-xl font-bold text-navy">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{step.description}</p>
                </div>
              </ScrollReveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
