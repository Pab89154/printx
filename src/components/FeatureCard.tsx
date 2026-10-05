import {
  GraduationCap,
  MapPin,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { Printer3d } from '../lib/printer3dIcon'

const iconMap: Record<string, LucideIcon> = {
  'map-pin': MapPin,
  'graduation-cap': GraduationCap,
  store: Store,
  'printer-3d': Printer3d as LucideIcon,
  printer: Printer3d as LucideIcon,
}

type Props = {
  title: string
  description: string
  icon: keyof typeof iconMap
}

export function FeatureCard({ title, description, icon }: Props) {
  const Icon = iconMap[icon]

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-electric/20 hover:shadow-lg hover:shadow-electric/5">
      <div className="mb-4 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-electric/10 text-electric transition-all duration-300 group-hover:-translate-y-1 group-hover:bg-electric group-hover:text-white group-hover:shadow-md group-hover:shadow-electric/25">
        <Icon size={22} strokeWidth={2} />
      </div>
      <h3 className="text-lg font-bold text-navy">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{description}</p>
    </div>
  )
}
