import { Building2 } from 'lucide-react'
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
              <div className="mb-4 inline-flex select-none items-center gap-2 rounded-full border border-electric/20 bg-electric/10 px-4 py-1.5 text-sm font-semibold text-electric transition-colors duration-150 hover:border-electric hover:bg-electric hover:text-white">
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
              <div className="flex flex-wrap gap-2">
                {SCHOOL_OFFERINGS.map((item) => (
                  <span
                    key={item.label}
                    className={`select-none rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${item.className}`}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            </ScrollReveal>
          </div>
        </div>
      </div>
    </section>
  )
}
