/** Lucide icons served from jsDelivr CDN — not generated locally. */
const LUCIDE_CDN = 'https://cdn.jsdelivr.net/npm/lucide-static@0.469.0/icons'

const CUSTOM_ICONS: Record<string, string> = {
  'printer-3d': '/icons/printer-3d.svg',
  printer: '/icons/printer-3d.svg',
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
  const slug = (name || 'package').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'package'
  if (CUSTOM_ICONS[slug]) return CUSTOM_ICONS[slug]
  return `${LUCIDE_CDN}/${slug}.svg`
}

type WebIconProps = {
  name: string
  className?: string
  alt?: string
  /** Invert SVG to white for dark backgrounds */
  light?: boolean
}

export function WebIcon({ name, className = '', alt = '', light = false }: WebIconProps) {
  return (
    <img
      src={lucideIconUrl(name)}
      alt={alt}
      className={`${light ? 'brightness-0 invert' : ''} ${className}`.trim()}
      loading="lazy"
      decoding="async"
    />
  )
}
