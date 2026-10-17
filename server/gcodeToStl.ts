/**
 * Read filament weight and time from a slicer G-code file, and build a
 * decimated toolpath mesh so the shop can preview and download an STL.
 */
import fs from 'node:fs'

const MAX_SEGMENTS = 40_000
const RIBBON_MM = 0.45

export type GcodeMetrics = {
  grams: number | null
  hours: number | null
}

function parseDurationToHours(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  let hours = 0
  const h = /(\d+(?:\.\d+)?)\s*h/i.exec(text)
  const m = /(\d+(?:\.\d+)?)\s*m/i.exec(text)
  const s = /(\d+(?:\.\d+)?)\s*s/i.exec(text)
  if (h) hours += Number(h[1])
  if (m) hours += Number(m[1]) / 60
  if (s) hours += Number(s[1]) / 3600
  if (h || m || s) return hours > 0 ? hours : null
  const colon = /^(\d+):(\d+)(?::(\d+))?/.exec(text)
  if (colon) {
    const a = Number(colon[1])
    const b = Number(colon[2])
    const c = colon[3] != null ? Number(colon[3]) : 0
    const total = colon[3] != null ? a + b / 60 + c / 3600 : a / 60 + b / 3600
    return total > 0 ? total : null
  }
  return null
}

/** Grams and hours from slicer comments (Bambu, Prusa, Cura). */
export function parseGcodeMetrics(text: string): GcodeMetrics {
  const blob = `${text.slice(0, 300_000)}\n${text.slice(-120_000)}`
  const gramsMatch =
    /total filament weight\s*\[g\]\s*[:=]\s*([0-9.]+)/i.exec(blob) ||
    /filament (?:used|weight)\s*\[g\]\s*[:=]\s*([0-9.]+)/i.exec(blob) ||
    /total filament used\s*\[g\]\s*[:=]\s*([0-9.]+)/i.exec(blob)
  const grams = gramsMatch ? Number(gramsMatch[1]) : null
  const timeMatch =
    /(?:total estimated time|model printing time|estimated printing time)\s*(?:\([^)]*\))?\s*[:=]\s*([^\n;]+)/i.exec(
      blob,
    )
  const hours = timeMatch ? parseDurationToHours(timeMatch[1] || '') : null
  return {
    grams: grams != null && Number.isFinite(grams) && grams > 0 ? grams : null,
    hours: hours != null && Number.isFinite(hours) && hours > 0 ? hours : null,
  }
}

function axis(code: string, letter: string): number | null {
  const m = new RegExp(`${letter}(-?\\d+(?:\\.\\d+)?)`, 'i').exec(code)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

type Seg = { ax: number; ay: number; az: number; bx: number; by: number; bz: number }

/** Keep a spread of extrusion moves so a long file still finishes on the worker. */
function collectSegments(text: string): Seg[] {
  let abs = true
  let eAbs = true
  let x = 0
  let y = 0
  let z = 0
  let e = 0
  const kept: Seg[] = []
  let seen = 0
  for (const raw of text.split(/\r?\n/)) {
    const cut = raw.split(';', 1)[0]?.trim() ?? ''
    if (!cut) continue
    if (/^G90\b/i.test(cut)) {
      abs = true
      continue
    }
    if (/^G91\b/i.test(cut)) {
      abs = false
      continue
    }
    if (/^M82\b/i.test(cut)) {
      eAbs = true
      continue
    }
    if (/^M83\b/i.test(cut)) {
      eAbs = false
      continue
    }
    if (/^G92\b/i.test(cut)) {
      const nx = axis(cut, 'X')
      const ny = axis(cut, 'Y')
      const nz = axis(cut, 'Z')
      const ne = axis(cut, 'E')
      if (nx != null) x = nx
      if (ny != null) y = ny
      if (nz != null) z = nz
      if (ne != null) e = ne
      continue
    }
    const move = /^G0*([01])\b/i.exec(cut)
    if (!move) continue
    const nx = axis(cut, 'X')
    const ny = axis(cut, 'Y')
    const nz = axis(cut, 'Z')
    const ne = axis(cut, 'E')
    const x2 = nx == null ? x : abs ? nx : x + nx
    const y2 = ny == null ? y : abs ? ny : y + ny
    const z2 = nz == null ? z : abs ? nz : z + nz
    let extruded = false
    let e2 = e
    if (ne != null) {
      if (eAbs) extruded = ne > e + 1e-4
      else extruded = ne > 1e-4
      e2 = eAbs ? ne : e + ne
    }
    if (move[1] === '1' && extruded) {
      const dx = x2 - x
      const dy = y2 - y
      const dz = z2 - z
      if (dx * dx + dy * dy + dz * dz >= 0.04) {
        seen += 1
        const seg = { ax: x, ay: y, az: z, bx: x2, by: y2, bz: z2 }
        if (kept.length < MAX_SEGMENTS) kept.push(seg)
        else {
          const j = Math.floor(Math.random() * seen)
          if (j < MAX_SEGMENTS) kept[j] = seg
        }
      }
    }
    x = x2
    y = y2
    z = z2
    e = e2
  }
  return kept
}

/** Binary STL of extrusion ribbons. About two triangles per kept segment. */
export function writeGcodePreviewStl(text: string, destPath: string): number {
  const segs = collectSegments(text)
  if (segs.length === 0) {
    throw new Error('This G-code has no extrusion moves to preview.')
  }
  const triCount = segs.length * 2
  const buf = Buffer.alloc(84 + triCount * 50)
  buf.write('printx gcode preview', 0, 'ascii')
  buf.writeUInt32LE(triCount, 80)
  let o = 84
  const w = RIBBON_MM
  for (const s of segs) {
    const dx = s.bx - s.ax
    const dy = s.by - s.ay
    const dz = s.bz - s.az
    const len = Math.hypot(dx, dy, dz) || 1
    let px = -dy / len
    let py = dx / len
    if (px * px + py * py < 1e-4) {
      px = 1
      py = 0
    }
    const ax1 = s.ax + px * w
    const ay1 = s.ay + py * w
    const ax2 = s.ax - px * w
    const ay2 = s.ay - py * w
    const bx1 = s.bx + px * w
    const by1 = s.by + py * w
    const bx2 = s.bx - px * w
    const by2 = s.by - py * w
    const tris = [
      ax1, ay1, s.az, bx1, by1, s.bz, bx2, by2, s.bz,
      ax1, ay1, s.az, bx2, by2, s.bz, ax2, ay2, s.az,
    ]
    for (let t = 0; t < 2; t++) {
      o += 12
      for (let i = 0; i < 9; i++) {
        buf.writeFloatLE(tris[t * 9 + i]!, o)
        o += 4
      }
      buf.writeUInt16LE(0, o)
      o += 2
    }
  }
  fs.writeFileSync(destPath, buf)
  return triCount
}
