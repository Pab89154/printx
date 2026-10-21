/**
 * Small software STL rasterizer used only to create the reference image sent
 * to Magic Hour. The shop keeps using the interactive Three.js viewer; this
 * renderer's job is to preserve the model's exact silhouette and part colors
 * well enough for the AI editor to turn it into a realistic product photo.
 */
import zlib from 'node:zlib'
import { measureStlBuffer, type StlBounds } from './stlFit.ts'

export type StlRenderPart = {
  buffer: Buffer
  colorHex: string
}

type ParsedPart = {
  positions: Float32Array
  color: [number, number, number]
  bounds: StlBounds
}

const MAX_TOTAL_TRIANGLES = 220_000

function isBinaryStl(buf: Buffer): boolean {
  if (buf.length < 84) return false
  const count = buf.readUInt32LE(80)
  return count > 0 && buf.length === 84 + count * 50
}

function parseColor(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [18, 181, 212]
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}

function parsePart(part: StlRenderPart, maxTriangles: number): ParsedPart | null {
  const bounds = measureStlBuffer(part.buffer)
  if (!bounds) return null
  const color = parseColor(part.colorHex)

  if (isBinaryStl(part.buffer)) {
    const count = part.buffer.readUInt32LE(80)
    const stride = Math.max(1, Math.ceil(count / Math.max(1, maxTriangles)))
    const sampled = Math.ceil(count / stride)
    const positions = new Float32Array(sampled * 9)
    let w = 0
    for (let i = 0; i < count; i += stride) {
      const base = 84 + i * 50 + 12
      for (let v = 0; v < 9; v++) positions[w++] = part.buffer.readFloatLE(base + v * 4)
    }
    return { positions: positions.subarray(0, w), color, bounds }
  }

  const text = part.buffer.toString('utf8')
  const vertices: number[] = []
  for (const match of text.matchAll(/vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g)) {
    vertices.push(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  const triangleCount = Math.floor(vertices.length / 9)
  if (!triangleCount) return null
  const stride = Math.max(1, Math.ceil(triangleCount / Math.max(1, maxTriangles)))
  const sampled = Math.ceil(triangleCount / stride)
  const positions = new Float32Array(sampled * 9)
  let w = 0
  for (let t = 0; t < triangleCount; t += stride) {
    for (let v = 0; v < 9; v++) positions[w++] = vertices[t * 9 + v] ?? 0
  }
  return { positions: positions.subarray(0, w), color, bounds }
}

function crc32(buf: Buffer): number {
  let table = (crc32 as unknown as { table?: Int32Array }).table
  if (!table) {
    table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    ;(crc32 as unknown as { table?: Int32Array }).table = table
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width * 4; x++) raw[p++] = rgba[y * width * 4 + x]!
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Render one or more STL parts into a white-background PNG product reference. */
export function renderStlPartsPng(parts: StlRenderPart[], size = 768): Buffer {
  const counts = parts.map((p) => {
    if (isBinaryStl(p.buffer)) return p.buffer.readUInt32LE(80)
    const matches = p.buffer.toString('utf8').match(/vertex\s/g)
    return Math.floor((matches?.length ?? 0) / 3)
  })
  const total = counts.reduce((a, b) => a + b, 0)
  if (!total) throw new Error('Could not read the STL model for the realistic image.')

  const parsed = parts
    .map((p, i) =>
      parsePart(p, Math.max(2_000, Math.floor((MAX_TOTAL_TRIANGLES * (counts[i] || 1)) / total))),
    )
    .filter((p): p is ParsedPart => Boolean(p))
  if (!parsed.length) throw new Error('Could not read the STL model for the realistic image.')

  const bounds: StlBounds = {
    minX: Math.min(...parsed.map((p) => p.bounds.minX)),
    minY: Math.min(...parsed.map((p) => p.bounds.minY)),
    minZ: Math.min(...parsed.map((p) => p.bounds.minZ)),
    maxX: Math.max(...parsed.map((p) => p.bounds.maxX)),
    maxY: Math.max(...parsed.map((p) => p.bounds.maxY)),
    maxZ: Math.max(...parsed.map((p) => p.bounds.maxZ)),
  }
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  }

  // Camera in front-right-above, Z-up (STL convention).
  const eye = normalize({ x: 1.05, y: -1.05, z: 0.72 })
  const forward = { x: -eye.x, y: -eye.y, z: -eye.z }
  const right = normalize(cross(forward, { x: 0, y: 0, z: 1 }))
  const up = cross(right, forward)
  const light = normalize({ x: -0.45, y: -0.35, z: 0.82 })

  type Projected = { positions: Float32Array; color: [number, number, number] }
  const projected: Projected[] = []
  let minPX = Infinity
  let maxPX = -Infinity
  let minPY = Infinity
  let maxPY = -Infinity

  for (const part of parsed) {
    const out = new Float32Array(part.positions.length)
    for (let i = 0; i < part.positions.length; i += 3) {
      const rel = {
        x: part.positions[i]! - center.x,
        y: part.positions[i + 1]! - center.y,
        z: part.positions[i + 2]! - center.z,
      }
      out[i] = dot(rel, right)
      out[i + 1] = dot(rel, up)
      out[i + 2] = dot(rel, eye) // larger = closer to camera
    }
    for (let i = 0; i < out.length; i += 3) {
      if (out[i]! < minPX) minPX = out[i]!
      if (out[i]! > maxPX) maxPX = out[i]!
      if (out[i + 1]! < minPY) minPY = out[i + 1]!
      if (out[i + 1]! > maxPY) maxPY = out[i + 1]!
    }
    projected.push({ positions: out, color: part.color })
  }

  const width = size
  const height = size
  const margin = size * 0.09
  const scale = Math.min(
    (width - margin * 2) / Math.max(maxPX - minPX, 1e-9),
    (height - margin * 2) / Math.max(maxPY - minPY, 1e-9),
  )
  const offsetX = width / 2 - ((minPX + maxPX) / 2) * scale
  const offsetY = height / 2 + ((minPY + maxPY) / 2) * scale // screen y is flipped

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 255
    rgba[i + 1] = 255
    rgba[i + 2] = 255
    rgba[i + 3] = 255
  }
  const depth = new Float32Array(width * height).fill(-Infinity)

  for (const part of projected) {
    const pos = part.positions
    for (let t = 0; t < pos.length; t += 9) {
      const ax = pos[t]! * scale + offsetX
      const ay = -pos[t + 1]! * scale + offsetY
      const az = pos[t + 2]!
      const bx = pos[t + 3]! * scale + offsetX
      const by = -pos[t + 4]! * scale + offsetY
      const bz = pos[t + 5]!
      const cx = pos[t + 6]! * scale + offsetX
      const cy = -pos[t + 7]! * scale + offsetY
      const cz = pos[t + 8]!

      // Face shading from the projected (camera-space) normal.
      const ux = bx - ax
      const uy = by - ay
      const uz = bz - az
      const vx = cx - ax
      const vy = cy - ay
      const vz = cz - az
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const nl = Math.hypot(nx, ny, nz)
      if (!nl) continue
      nx /= nl
      ny /= nl
      nz /= nl
      // Camera-space light: from upper-left and in front of the object.
      const diffuse = Math.abs(nx * -0.35 + ny * 0.55 + nz * 0.72)
      const shade = Math.min(1.08, 0.58 + diffuse * 0.5)
      const r = Math.min(255, part.color[0] * shade)
      const g = Math.min(255, part.color[1] * shade)
      const b = Math.min(255, part.color[2] * shade)

      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (Math.abs(area) < 1e-9) continue
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area
          const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area
          const w2 = 1 - w0 - w1
          if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue
          const z = w0 * az + w1 * bz + w2 * cz
          const idx = y * width + x
          if (z <= depth[idx]!) continue
          depth[idx] = z
          const p = idx * 4
          rgba[p] = r
          rgba[p + 1] = g
          rgba[p + 2] = b
          rgba[p + 3] = 255
        }
      }
    }
  }

  // Sampled triangles can leave pinholes in curved meshes. Fill enclosed
  // specks with the neighboring part color so Magic Hour receives a solid
  // silhouette instead of static. Background remains connected and untouched.
  for (let iter = 0; iter < 3; iter++) {
    const fills: { idx: number; r: number; g: number; b: number }[] = []
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x
        if (Number.isFinite(depth[idx])) continue
        let count = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const nIdx = (y + dy) * width + (x + dx)
            if (!Number.isFinite(depth[nIdx])) continue
            count++
            r += rgba[nIdx * 4]!
            g += rgba[nIdx * 4 + 1]!
            b += rgba[nIdx * 4 + 2]!
          }
        }
        if (count >= 4) fills.push({ idx, r: r / count, g: g / count, b: b / count })
      }
    }
    if (!fills.length) break
    for (const fill of fills) {
      depth[fill.idx] = 0
      rgba[fill.idx * 4] = fill.r
      rgba[fill.idx * 4 + 1] = fill.g
      rgba[fill.idx * 4 + 2] = fill.b
    }
  }

  // `light` is kept for parity with the camera-space approximation above.
  void light
  return encodePng(rgba, width, height)
}

type Vec = { x: number; y: number; z: number }
function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function cross(a: Vec, b: Vec): Vec {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function normalize(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}
