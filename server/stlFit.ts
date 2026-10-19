/**
 * Cloud Slicer rejects meshes larger than the printer bed.
 * Articulated models are often exported 10× too big (3185mm vs a ~250mm bed).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PRINTER_BED_MM: Record<string, number> = {
  pablo_p1s: 240,
  court_ender: 200,
  josh_kobra: 210,
}

type Box = { dx: number; dy: number; dz: number }

export type StlBounds = {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

function finiteBounds(b: StlBounds): boolean {
  return [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every((n) => Number.isFinite(n))
}

export function boundsSizeMm(b: StlBounds): { xMm: number; yMm: number; zMm: number } | null {
  if (!finiteBounds(b)) return null
  const xMm = b.maxX - b.minX
  const yMm = b.maxY - b.minY
  const zMm = b.maxZ - b.minZ
  if (xMm <= 0 || yMm <= 0 || zMm <= 0) return null
  return { xMm, yMm, zMm }
}

export function unionBounds(list: StlBounds[]): StlBounds | null {
  if (!list.length) return null
  const out: StlBounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  }
  for (const b of list) {
    if (!finiteBounds(b)) continue
    out.minX = Math.min(out.minX, b.minX)
    out.minY = Math.min(out.minY, b.minY)
    out.minZ = Math.min(out.minZ, b.minZ)
    out.maxX = Math.max(out.maxX, b.maxX)
    out.maxY = Math.max(out.maxY, b.maxY)
    out.maxZ = Math.max(out.maxZ, b.maxZ)
  }
  return finiteBounds(out) ? out : null
}

export function measureStlBuffer(buf: Buffer): StlBounds | null {
  if (buf.length < 84) return null
  if (isBinaryStl(buf)) return binaryBounds(buf)
  return asciiBounds(buf.toString('utf8'))
}

function isBinaryStl(buf: Buffer): boolean {
  if (buf.length < 84) return false
  const count = buf.readUInt32LE(80)
  return count > 0 && buf.length === 84 + count * 50
}

function binaryBounds(buf: Buffer): StlBounds {
  const count = buf.readUInt32LE(80)
  const out: StlBounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  }
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12
      const x = buf.readFloatLE(o)
      const y = buf.readFloatLE(o + 4)
      const z = buf.readFloatLE(o + 8)
      if (x < out.minX) out.minX = x
      if (y < out.minY) out.minY = y
      if (z < out.minZ) out.minZ = z
      if (x > out.maxX) out.maxX = x
      if (y > out.maxY) out.maxY = y
      if (z > out.maxZ) out.maxZ = z
    }
  }
  return out
}

function binaryBox(buf: Buffer): Box {
  const b = binaryBounds(buf)
  return { dx: b.maxX - b.minX, dy: b.maxY - b.minY, dz: b.maxZ - b.minZ }
}

function scaleBinary(buf: Buffer, factor: number): Buffer {
  const out = Buffer.from(buf)
  const count = out.readUInt32LE(80)
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12
      out.writeFloatLE(out.readFloatLE(o) * factor, o)
      out.writeFloatLE(out.readFloatLE(o + 4) * factor, o + 4)
      out.writeFloatLE(out.readFloatLE(o + 8) * factor, o + 8)
    }
  }
  return out
}

function asciiBounds(text: string): StlBounds {
  const out: StlBounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  }
  for (const match of text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)) {
    const x = Number(match[1])
    const y = Number(match[2])
    const z = Number(match[3])
    if (x < out.minX) out.minX = x
    if (y < out.minY) out.minY = y
    if (z < out.minZ) out.minZ = z
    if (x > out.maxX) out.maxX = x
    if (y > out.maxY) out.maxY = y
    if (z > out.maxZ) out.maxZ = z
  }
  return out
}

function asciiBoxAndScale(text: string, factor: number | null): { box: Box; text?: string } {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const next = factor
    ? text.replace(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, (_m, xs, ys, zs) => {
        const x = Number(xs) * factor
        const y = Number(ys) * factor
        const z = Number(zs) * factor
        return `vertex ${x} ${y} ${z}`
      })
    : undefined
  for (const match of text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)) {
    const x = Number(match[1])
    const y = Number(match[2])
    const z = Number(match[3])
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return {
    box: { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ },
    text: next,
  }
}

/** If the mesh is larger than `maxMm` on any axis, write a scaled copy that fits. */
export function fitStlToBed(
  inputPath: string,
  maxMm: number,
): { path: string; scaled: boolean; factor: number; sizeMm: number; cleanup?: () => void } {
  const buf = fs.readFileSync(inputPath)
  const binary = isBinaryStl(buf)
  const box = binary ? binaryBox(buf) : asciiBoxAndScale(buf.toString('utf8'), null).box
  const size = Math.max(box.dx, box.dy, box.dz)
  if (!Number.isFinite(size) || size <= 0 || size <= maxMm + 0.5) {
    return { path: inputPath, scaled: false, factor: 1, sizeMm: size }
  }
  const factor = maxMm / size
  const outPath = path.join(os.tmpdir(), `printx-fit-${Date.now()}-${path.basename(inputPath)}`)
  if (binary) {
    fs.writeFileSync(outPath, scaleBinary(buf, factor))
  } else {
    const scaled = asciiBoxAndScale(buf.toString('utf8'), factor).text
    if (!scaled) throw new Error('Could not scale STL.')
    fs.writeFileSync(outPath, scaled)
  }
  return {
    path: outPath,
    scaled: true,
    factor,
    sizeMm: size,
    cleanup: () => {
      try {
        fs.rmSync(outPath, { force: true })
      } catch {
        /* ignore */
      }
    },
  }
}
