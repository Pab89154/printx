import {
  BookOpen,
  FolderOpen,
  KeyRound,
  Loader,
  Package,
  Pencil,
  Ruler,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { HomePrinterIcon } from './homePrinterIcon'

const ICONS: Record<string, LucideIcon> = {
  loader: Loader,
  'key-round': KeyRound,
  smartphone: Smartphone,
  'folder-open': FolderOpen,
  'book-open': BookOpen,
  sparkles: Sparkles,
  package: Package,
  pencil: Pencil,
  ruler: Ruler,
  'printer-3d': HomePrinterIcon as LucideIcon,
  printer: HomePrinterIcon as LucideIcon,
}

export const PRODUCT_ICON_OPTIONS = [
  { value: 'loader', label: 'Fidget / Spinner' },
  { value: 'key-round', label: 'Keychain' },
  { value: 'smartphone', label: 'Phone' },
  { value: 'folder-open', label: 'Desk / Files' },
  { value: 'book-open', label: 'School' },
  { value: 'sparkles', label: 'Custom' },
  { value: 'package', label: 'Package' },
  { value: 'printer-3d', label: '3D Printer' },
  { value: 'pencil', label: 'Pencil' },
  { value: 'ruler', label: 'Ruler' },
] as const

export function lucideIconUrl(name: string): string {
  // Kept for any legacy callers; icons now render inline via WebIcon.
  const slug = (name || 'package').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'package'
  if (slug === 'printer-3d' || slug === 'printer') return '/icons/printer-3d.svg'
  return `https://cdn.jsdelivr.net/npm/lucide-static@0.469.0/icons/${slug}.svg`
}

type WebIconProps = {
  name: string
  className?: string
  alt?: string
  /** White icon for dark / colored backgrounds */
  light?: boolean
}

export function WebIcon({ name, className = '', alt = '', light = false }: WebIconProps) {
  const slug = (name || 'package').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'package'
  const Icon = ICONS[slug] ?? Package
  const colorClass = light ? 'text-white' : 'text-navy'

  return (
    <Icon
      className={`${colorClass} ${className}`.trim()}
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      role={alt ? 'img' : undefined}
    />
  )
}
