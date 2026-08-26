import { Calendar, Clock, MapPin, Package } from 'lucide-react'
import type { PublicStand } from '../types/api'
import { usePublicData } from '../context/PublicDataContext'
import { ScrollReveal } from './ScrollReveal'
import { SectionHeading } from './SectionHeading'

const statusStyles: Record<PublicStand['status'], { label: string; className: string }> = {
  upcoming: { label: 'Upcoming', className: 'bg-electric/10 text-electric' },
  active: { label: 'Today', className: 'bg-cyan/10 text-cyan-700' },
  past: { label: 'Past', className: 'bg-slate-100 text-slate-500' },
}

function StandCard({ stand }: { stand: PublicStand }) {
  const status = statusStyles[stand.status]

  return (
    <article className={`rounded-2xl border bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${stand.status === 'past' ? 'border-slate-100 opacity-75' : 'border-slate-100 hover:border-electric/20'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h3 className="text-xl font-bold text-navy">{stand.schoolName}</h3>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>
      <ul className="space-y-2.5 text-sm text-slate-600">
        <li className="flex items-center gap-2.5"><Calendar size={16} className="shrink-0 text-electric" />{stand.displayDate}</li>
        <li className="flex items-center gap-2.5"><Clock size={16} className="shrink-0 text-electric" />{stand.time}</li>
        <li className="flex items-center gap-2.5"><MapPin size={16} className="shrink-0 text-electric" />{stand.location}</li>
      </ul>
      {stand.products.length > 0 && (
        <div className="mt-4 rounded-xl bg-surface p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <Package size={14} /> Available products
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stand.products.map((product) => (
              <span key={product} className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-slate-600">{product}</span>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

export function WhereToFindUs() {
  const { data } = usePublicData()
  const upcoming = data?.stands ?? []
  const past = data?.pastStands ?? []

  return (
    <section id="stands" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal>
          <SectionHeading
            title="Find Us at a School Near You"
            subtitle="We sell our prints in person at PrintX stands, usually at schools around McKinney."
          />
        </ScrollReveal>

        {upcoming.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2">
            {upcoming.map((stand, i) => (
              <ScrollReveal key={stand.id} delay={i * 100}>
                <StandCard stand={stand} />
              </ScrollReveal>
            ))}
          </div>
        ) : (
          <ScrollReveal>
            <div className="rounded-2xl border border-dashed border-slate-200 bg-surface px-6 py-16 text-center">
              <p className="text-lg font-medium text-navy">No upcoming stands right now. Check back soon!</p>
            </div>
          </ScrollReveal>
        )}

        {past.length > 0 && (
          <ScrollReveal className="mt-16">
            <h3 className="mb-6 text-sm font-bold uppercase tracking-wider text-muted">Past Stands</h3>
            <div className="grid gap-6 md:grid-cols-2">
              {past.map((stand) => (
                <StandCard key={stand.id} stand={stand} />
              ))}
            </div>
          </ScrollReveal>
        )}
      </div>
    </section>
  )
}
