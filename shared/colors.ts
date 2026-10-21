/** Built-in PrintX catalog colors + up to 5 custom portal slots. */

export type ColorDef = {
  id: string
  code: string
  name: string
  hex: string
  builtin: boolean
}

/** Single shop option for multicolor-only designs (SKU suffix MLT). */
export const MULTICOLOR_COLOR_ID = 'multicolor'

/** How many filament colors the customer must pick for a multicolor print. */
export const MULTICOLOR_SLOT_MIN = 2
export const MULTICOLOR_SLOT_MAX = 4
export const MULTICOLOR_SLOT_DEFAULT = 2

export function clampMulticolorSlotCount(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return MULTICOLOR_SLOT_DEFAULT
  return Math.min(MULTICOLOR_SLOT_MAX, Math.max(MULTICOLOR_SLOT_MIN, v))
}

/** Default region labels for multicolor part STLs (Body / Accent / …). */
export const DEFAULT_MULTICOLOR_PART_LABELS = ['Body', 'Accent', 'Detail', 'Extra'] as const

export function defaultMulticolorPartLabel(index: number): string {
  return DEFAULT_MULTICOLOR_PART_LABELS[index] ?? `Color ${index + 1}`
}

export const MULTICOLOR_COLOR: ColorDef = {
  id: MULTICOLOR_COLOR_ID,
  code: 'MLT',
  name: 'Multicolor',
  /** Solid tint for STL preview; UI swatches use a gradient instead. */
  hex: '#7C3AED',
  builtin: true,
}

/**
 * Display label for chosen filaments.
 * With slot labels: "Body: Red · Accent: Blue".
 * Without: "Multicolor · Red + Blue".
 */
export function formatMulticolorSelection(names: string[], labels?: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (!clean.length) return MULTICOLOR_COLOR.name
  if (labels && labels.length >= clean.length) {
    return clean
      .map((n, i) => {
        const label = (labels[i] || '').trim() || defaultMulticolorPartLabel(i)
        return `${label}: ${n}`
      })
      .join(' · ')
  }
  return `${MULTICOLOR_COLOR.name} · ${clean.join(' + ')}`
}

/** CSS background for multicolor swatches — horizontal rainbow stripes. */
export const MULTICOLOR_SWATCH_BACKGROUND =
  'linear-gradient(180deg, #E11D48 0% 16.67%, #EA580C 16.67% 33.33%, #EAB308 33.33% 50%, #16A34A 50% 66.67%, #2563EB 66.67% 83.33%, #7C3AED 83.33% 100%)'

export function isMulticolorColorId(id: string | null | undefined): boolean {
  return id === MULTICOLOR_COLOR_ID
}

export function colorSwatchStyle(color: { id: string; hex: string }): { background: string } {
  if (isMulticolorColorId(color.id)) return { background: MULTICOLOR_SWATCH_BACKGROUND }
  return { background: color.hex }
}

export const BUILTIN_COLORS: ColorDef[] = [
  { id: 'white', code: 'WHT', name: 'White', hex: '#F5F7FA', builtin: true },
  { id: 'red', code: 'RED', name: 'Red', hex: '#E11D48', builtin: true },
  { id: 'black', code: 'BLK', name: 'Black', hex: '#0B1220', builtin: true },
  { id: 'gray', code: 'GRY', name: 'Gray', hex: '#6B7280', builtin: true },
  { id: 'blue', code: 'BLU', name: 'Blue', hex: '#2563EB', builtin: true },
  { id: 'green', code: 'GRN', name: 'Green', hex: '#16A34A', builtin: true },
  { id: 'orange', code: 'ORG', name: 'Orange', hex: '#EA580C', builtin: true },
  { id: 'yellow', code: 'YLW', name: 'Yellow', hex: '#EAB308', builtin: true },
  { id: 'purple', code: 'PRP', name: 'Purple', hex: '#7C3AED', builtin: true },
  { id: 'pink', code: 'PNK', name: 'Pink', hex: '#F472B6', builtin: true },
  { id: 'brown', code: 'BRN', name: 'Brown', hex: '#8B5A2B', builtin: true },
  MULTICOLOR_COLOR,
]

/** Solid filament chips in admin (excludes Multicolor — that is a design mode). */
export function solidBuiltinColors(): ColorDef[] {
  return BUILTIN_COLORS.filter((c) => !isMulticolorColorId(c.id))
}

/** Keep only known basic filament ids, in palette order. */
export function parseOwnedColorIds(input: unknown): string[] {
  let list: unknown[] = []
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (Array.isArray(parsed)) list = parsed
    } catch {
      list = []
    }
  } else if (Array.isArray(input)) {
    list = input
  }
  const picked = new Set(list.map((id) => String(id)))
  return solidBuiltinColors()
    .map((c) => c.id)
    .filter((id) => picked.has(id))
}

/**
 * A basic color is offered only when some admin has it.
 * An empty stock list means nobody has saved colors yet, so every basic color stays available.
 * Custom slots are not part of that list.
 */
export function isOfferedFilament(colorId: string, stockIds: string[]): boolean {
  if (!stockIds.length) return true
  const basic = solidBuiltinColors().some((c) => c.id === colorId)
  if (!basic) return true
  return stockIds.includes(colorId)
}

export const CUSTOM_COLOR_SLOT_COUNT = 5

export type CustomColorSlot = {
  id: string
  name: string
  hex: string
  code: string
}

export function emptyCustomColorSlots(): CustomColorSlot[] {
  return Array.from({ length: CUSTOM_COLOR_SLOT_COUNT }, (_, i) => ({
    id: `custom_${i + 1}`,
    name: '',
    hex: '#12B5D4',
    code: `C${i + 1}`,
  }))
}

export function normalizeCustomSlots(input: unknown): CustomColorSlot[] {
  const base = emptyCustomColorSlots()
  if (!Array.isArray(input)) return base
  for (let i = 0; i < CUSTOM_COLOR_SLOT_COUNT; i++) {
    const raw = input[i]
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    base[i] = {
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `custom_${i + 1}`,
      name: typeof row.name === 'string' ? row.name.trim().slice(0, 40) : '',
      hex:
        typeof row.hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(row.hex.trim())
          ? row.hex.trim().toUpperCase()
          : '#12B5D4',
      code:
        typeof row.code === 'string' && row.code.trim()
          ? row.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || `C${i + 1}`
          : `C${i + 1}`,
    }
  }
  return base
}

/** Builtin + filled custom slots. */
export function allActiveColors(customSlots: CustomColorSlot[]): ColorDef[] {
  const customs = customSlots
    .filter((c) => c.name.trim())
    .map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name.trim(),
      hex: c.hex,
      builtin: false,
    }))
  return [...BUILTIN_COLORS, ...customs]
}

export function colorById(id: string, customSlots: CustomColorSlot[]): ColorDef | null {
  return allActiveColors(customSlots).find((c) => c.id === id) ?? null
}

export function buildSku(skuBase: string, colorCode: string): string {
  const base = skuBase.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const code = colorCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${base}-${code}`
}
