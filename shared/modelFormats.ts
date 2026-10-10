/** 3D model formats accepted for design uploads. */
export const MODEL_EXTS = ['.stl', '.obj', '.3mf', '.step', '.stp'] as const

export type ModelExt = (typeof MODEL_EXTS)[number]

export const MODEL_ACCEPT = MODEL_EXTS.join(',')

/** Cloud Slicer auto-quote works reliably with these. */
export const SLICEABLE_EXTS = new Set<string>(['.stl', '.3mf'])

export function isModelExt(ext: string): ext is ModelExt {
  return (MODEL_EXTS as readonly string[]).includes(ext.toLowerCase())
}

export function modelContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.stl':
      return 'model/stl'
    case '.obj':
      return 'model/obj'
    case '.3mf':
      return 'model/3mf'
    case '.step':
    case '.stp':
      return 'model/step'
    default:
      return 'application/octet-stream'
  }
}

export function modelLabel(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  return e ? e.toUpperCase() : 'MODEL'
}
