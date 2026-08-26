import {
  GraduationCap,
  MapPin,
  Printer,
  Store,
  type LucideIcon,
} from 'lucide-react'

const iconMap: Record<string, LucideIcon> = {
  'map-pin': MapPin,
  'graduation-cap': GraduationCap,
  store: Store,
  printer: Printer,
}

type Props = {
  title: string
  description: string
  icon: keyof typeof iconMap
}

export function FeatureCard({ title, description, icon }: Props) {
  const Icon = iconMap[icon]

  return (
    <div className="group rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-electric/20 hover:shadow-lg hover:shadow-electric/5">
      <div className="mb-4 inline-flex rounded-xl bg-electric/10 p-3 text-electric transition-colors duration-300 group-hover:bg-electric group-hover:text-white">
        <Icon size={22} strokeWidth={2} />
      </div>
      <h3 className="text-lg font-bold text-navy">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  )
}
