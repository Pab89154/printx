/** 3D model formats accepted for design uploads. */
export const MODEL_EXTS = ['.stl', '.gcode'] as const

export type ModelExt = (typeof MODEL_EXTS)[number]

export const MODEL_ACCEPT = MODEL_EXTS.join(',')

/** Cloud Slicer auto-quote works with STL. G-code is already sliced. */
export const SLICEABLE_EXTS = new Set<string>(['.stl'])

export function isModelExt(ext: string): ext is ModelExt {
  return (MODEL_EXTS as readonly string[]).includes(ext.toLowerCase())
}

export function modelContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.stl':
      return 'model/stl'
    case '.gcode':
      return 'text/plain'
    default:
      return 'application/octet-stream'
  }
}

export function modelLabel(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'gcode') return 'G-code'
  return e ? e.toUpperCase() : 'MODEL'
}
