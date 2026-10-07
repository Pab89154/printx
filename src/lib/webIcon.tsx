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
  type LucideProps,
} from 'lucide-react'

/** Custom 3D-printer mark (not in Lucide). Uses currentColor so parent text color wins. */
function Printer3dIcon({ className, ...props }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={props['aria-hidden'] ?? true}
      {...props}
    >
      <path d="M7 20V8" />
      <path d="M17 20V8" />
      <path d="M7 8h10" />
      <path d="M6 20h12" />
      <path d="M12 8v2" />
      <path d="M10.5 10h3" />
      <path d="M12 10v2.5" />
      <path d="M11.5 12.5 12 14 12.5 12.5" />
      <path d="M12 15 10.5 17" />
      <path d="M12 15 13.5 17" />
      <path d="M10.5 17v2" />
      <path d="M13.5 17v2" />
      <path d="M10.5 19h3" />
    </svg>
  )
}

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
  'printer-3d': Printer3dIcon as LucideIcon,
  printer: Printer3dIcon as LucideIcon,
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
