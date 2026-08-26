import { Building2, CheckCircle2 } from 'lucide-react'
import { usePublicData } from '../context/PublicDataContext'
import { SCHOOL_OFFERINGS } from '../data/products'
import { Button } from './Button'
import { ScrollReveal } from './ScrollReveal'

export function ForSchools() {
  const { data } = usePublicData()
  const content = data?.content

  return (
    <section id="schools" className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl">
          <div className="grid lg:grid-cols-2">
            <ScrollReveal className="p-8 sm:p-12">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-electric/10 px-4 py-1.5 text-sm font-semibold text-electric">
                <Building2 size={16} /> For Educators & Staff
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Bring PrintX to Your School</h2>
              <p className="mt-4 text-lg leading-relaxed text-muted">{content?.forSchoolsDescription}</p>
              {content?.forSchoolsInstructions && (
                <p className="mt-3 text-sm text-muted">{content.forSchoolsInstructions}</p>
              )}
              <Button href="#contact" size="lg" className="mt-8">Contact PrintX</Button>
            </ScrollReveal>
            <ScrollReveal delay={150} className="bg-navy/5 p-8 sm:p-12">
              <ul className="grid gap-3 sm:grid-cols-2">
                {SCHOOL_OFFERINGS.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 size={16} className="shrink-0 text-electric" />{item}
                  </li>
                ))}
              </ul>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  )
}
