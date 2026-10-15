/** Multicolor designs store one G-code per part: `printerId#0`, `printerId#1`, … */

import { defaultMulticolorPartLabel } from '../shared/colors.ts'
import type { DesignPart } from './catalog.ts'

export function partGcodeKey(printerId: string, partIndex: number): string {
  return `${printerId}#${partIndex}`
}

export function gcodeKeyPrinterId(key: string): string {
  const hash = key.indexOf('#')
  return hash >= 0 ? key.slice(0, hash) : key
}

export type GcodeSliceTarget = {
  stlPath: string
  /** null = single-color design (bare printerId key). */
  partIndex: number | null
  label: string
  storageKey: (printerId: string) => string
}

/** STLs to slice for a design — one per multicolor part, else the main model. */
export function designGcodeSliceTargets(design: {
  multicolorOnly: boolean
  parts: DesignPart[]
  stlPath: string
}): GcodeSliceTarget[] {
  if (design.multicolorOnly) {
    const parts = design.parts.filter((p) => p.stlPath.trim())
    if (parts.length > 0) {
      return parts.map((p, i) => {
        const label = p.label.trim() || defaultMulticolorPartLabel(i)
        return {
          stlPath: p.stlPath.trim(),
          partIndex: i,
          label,
          storageKey: (printerId: string) => partGcodeKey(printerId, i),
        }
      })
    }
  }
  const stlPath = design.stlPath.trim()
  if (!stlPath) return []
  return [
    {
      stlPath,
      partIndex: null,
      label: '',
      storageKey: (printerId: string) => printerId,
    },
  ]
}

export function printerHasStoredGcodes(
  gcodePaths: Record<string, string>,
  printerId: string,
  partCount: number,
): boolean {
  if (partCount <= 1) {
    // Single-color, or legacy multicolor that only stored the bare printer key.
    return Boolean(gcodePaths[printerId]?.trim())
  }
  for (let i = 0; i < partCount; i++) {
    if (!gcodePaths[partGcodeKey(printerId, i)]?.trim()) return false
  }
  return true
}

/** Printer ids that have every required part G-code on disk/storage. */
export function gcodeReadyPrinterIds(
  gcodePaths: Record<string, string>,
  partCount: number,
): string[] {
  const ids = new Set<string>()
  for (const key of Object.keys(gcodePaths)) {
    if (!gcodePaths[key]?.trim()) continue
    ids.add(gcodeKeyPrinterId(key))
  }
  return [...ids].filter((id) => printerHasStoredGcodes(gcodePaths, id, partCount))
}

export function safeGcodeFilenamePart(label: string, partIndex: number): string {
  const raw = label.trim() || defaultMulticolorPartLabel(partIndex)
  return raw.replace(/[^\w.-]+/g, '_').slice(0, 40) || `part${partIndex + 1}`
}
