import {
  Building2,
  Calendar,
  FlaskConical,
  Sparkles,
  Store,
  Users,
} from 'lucide-react'
import { usePublicData } from '../context/PublicDataContext'
import { SCHOOL_HOST_STEPS, SCHOOL_OFFERINGS } from '../data/products'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

const offeringIcons = {
  store: Store,
  flask: FlaskConical,
  users: Users,
  calendar: Calendar,
  sparkles: Sparkles,
} as const

export function ForSchools() {
  const { data } = usePublicData()
  const content = data?.content

  return (
    <section id="schools" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl">
          <div className="grid lg:grid-cols-2">
            <ScrollReveal className="p-8 sm:p-12">
              <div className="mb-4 inline-flex select-none items-center gap-2 rounded-full border border-electric/20 bg-electric/10 px-4 py-1.5 text-sm font-semibold text-electric transition-colors duration-150 hover:border-electric hover:bg-electric hover:text-white">
                <Building2 size={16} /> For Educators & Staff
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Bring PrintX to Your School</h2>
              <p className="mt-4 text-lg leading-relaxed text-muted">{content?.forSchoolsDescription}</p>
              {content?.forSchoolsInstructions && (
                <p className="mt-3 text-sm text-muted">{content.forSchoolsInstructions}</p>
              )}

              <div className="mt-8 space-y-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">How hosting works</p>
                {SCHOOL_HOST_STEPS.map((step) => (
                  <div key={step.step} className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-electric text-sm font-bold text-white">
                      {step.step}
                    </div>
                    <div>
                      <p className="font-semibold text-navy">{step.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Button href="#contact" size="lg" className="mt-8">Contact PrintX</Button>
            </ScrollReveal>

            <ScrollReveal delay={150} className="bg-navy/5 p-8 sm:p-12">
              <p className="mb-4 text-xs font-bold uppercase tracking-wider text-muted">What we can bring</p>
              <div className="mb-5 flex flex-wrap gap-2">
                {SCHOOL_OFFERINGS.map((item) => (
                  <span
                    key={item.label}
                    className={`select-none rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${item.className}`}
                  >
                    {item.label}
                  </span>
                ))}
              </div>

              <ul className="space-y-3">
                {SCHOOL_OFFERINGS.map((item) => {
                  const Icon = offeringIcons[item.icon]
                  return (
                    <li
                      key={item.label}
                      className="flex gap-3 rounded-2xl border border-white/80 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.iconClass}`}
                      >
                        <Icon size={18} strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-navy">{item.label}</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-muted">{item.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>

              <div className="mt-5 rounded-2xl border border-emerald-200/70 bg-emerald-50/80 p-4">
                <p className="text-sm font-semibold text-emerald-800">Easy for schools</p>
                <p className="mt-1 text-sm leading-relaxed text-emerald-900/80">
                  Student-run, local to McKinney, and set up for lunch periods, club meetings, or bigger campus events.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  )
}
