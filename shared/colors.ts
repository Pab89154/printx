/** Built-in PrintX catalog colors + up to 5 custom portal slots. */

export type ColorDef = {
  id: string
  code: string
  name: string
  hex: string
  builtin: boolean
}

export const BUILTIN_COLORS: ColorDef[] = [
  { id: 'white', code: 'WHT', name: 'White', hex: '#F5F7FA', builtin: true },
  { id: 'red', code: 'RED', name: 'Red', hex: '#E11D48', builtin: true },
  { id: 'black', code: 'BLK', name: 'Black', hex: '#0B1220', builtin: true },
  { id: 'gray', code: 'GRY', name: 'Gray', hex: '#6B7280', builtin: true },
  { id: 'blue', code: 'BLU', name: 'Blue', hex: '#2563EB', builtin: true },
  { id: 'green', code: 'GRN', name: 'Green', hex: '#16A34A', builtin: true },
  { id: 'orange', code: 'ORG', name: 'Orange', hex: '#EA580C', builtin: true },
  { id: 'purple', code: 'PRP', name: 'Purple', hex: '#7C3AED', builtin: true },
]

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
