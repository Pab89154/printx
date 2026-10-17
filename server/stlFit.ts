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

function isBinaryStl(buf: Buffer): boolean {
  if (buf.length < 84) return false
  const count = buf.readUInt32LE(80)
  return count > 0 && buf.length === 84 + count * 50
}

function binaryBox(buf: Buffer): Box {
  const count = buf.readUInt32LE(80)
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    const base = 84 + i * 50 + 12
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12
      const x = buf.readFloatLE(o)
      const y = buf.readFloatLE(o + 4)
      const z = buf.readFloatLE(o + 8)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }
  return { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ }
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
