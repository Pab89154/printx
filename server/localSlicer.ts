/** Headless local slicer (Bambu Studio / Orca CLI) — Free Cloud Slicer never releases G-code. */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type LocalSliceResult = {
  buffer: Buffer
  filename: string
  grams: number
  hours: number
}

type PrinterProfile = {
  /** Vendor folder under …/profiles (BBL, Creality, Anycubic, …). */
  vendor: string
  machine: string
  process: string
  filament: string
}

/**
 * Relative paths under …/profiles/{vendor}/.
 * josh_kobra uses Kobra 2 profiles (closest bundled match for “Kobra X”).
 */
const PRINTER_PROFILES: Record<string, PrinterProfile> = {
  pablo_p1s: {
    vendor: 'BBL',
    machine: 'machine/Bambu Lab P1S 0.4 nozzle.json',
    process: 'process/0.20mm Standard @BBL X1C.json',
    filament: 'filament/Bambu PLA Basic @BBL P1S 0.4 nozzle.json',
  },
  court_ender: {
    vendor: 'Creality',
    machine: 'machine/Creality Ender-3 V2 0.4 nozzle.json',
    process: 'process/0.20mm Standard @Creality Ender3V2.json',
    filament: 'filament/Generic PLA @Creality.json',
  },
  josh_kobra: {
    vendor: 'Anycubic',
    machine: 'machine/Anycubic Kobra 2 0.4 nozzle.json',
    process: 'process/0.20mm Standard @Anycubic Kobra2.json',
    filament: 'filament/Generic PLA @Anycubic.json',
  },
}

function candidateBins(): string[] {
  const fromEnv = process.env.PRINTX_SLICER_BIN?.trim()
  const home = process.env.PRINTX_SLICER_HOME?.trim()
  return [
    fromEnv,
    home ? path.join(home, 'AppRun') : '',
    home ? path.join(home, 'bambu-studio') : '',
    '/opt/printx-slicer/AppRun',
    '/opt/printx-slicer/bambu-studio',
    '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio',
  ].filter(Boolean) as string[]
}

/** Parent …/profiles directory that contains BBL/, Creality/, Anycubic/, … */
function candidateProfilesBases(): string[] {
  const fromEnv = process.env.PRINTX_SLICER_PROFILES?.trim()
  const legacyBbl = process.env.PRINTX_BAMBU_PROFILE_ROOT?.trim()
  const home = process.env.PRINTX_SLICER_HOME?.trim()
  const fromLegacy = legacyBbl
    ? path.basename(legacyBbl) === 'BBL'
      ? path.dirname(legacyBbl)
      : legacyBbl
    : ''
  return [
    fromEnv,
    fromLegacy,
    home ? path.join(home, 'resources', 'profiles') : '',
    home ? path.join(home, 'usr', 'share', 'BambuStudio', 'profiles') : '',
    '/opt/printx-slicer/resources/profiles',
    '/Applications/BambuStudio.app/Contents/Resources/profiles',
  ].filter(Boolean) as string[]
}

export function resolveLocalSlicerBin(): string | null {
  for (const bin of candidateBins()) {
    try {
      if (fs.existsSync(bin) && fs.statSync(bin).isFile()) return bin
    } catch {
      /* skip */
    }
  }
  return null
}

export function resolveProfilesBase(): string | null {
  for (const base of candidateProfilesBases()) {
    try {
      if (fs.existsSync(path.join(base, 'BBL', 'machine')) || fs.existsSync(path.join(base, 'Creality', 'machine'))) {
        return base
      }
    } catch {
      /* skip */
    }
  }
  return null
}

/** @deprecated Use resolveVendorProfileRoot — kept for older scripts. */
export function resolveBambuProfileRoot(): string | null {
  return resolveVendorProfileRoot('BBL')
}

export function resolveVendorProfileRoot(vendor: string): string | null {
  const base = resolveProfilesBase()
  if (!base) return null
  const root = path.join(base, vendor)
  try {
    if (fs.existsSync(path.join(root, 'machine')) && fs.existsSync(path.join(root, 'process'))) {
      return root
    }
  } catch {
    /* skip */
  }
  return null
}

export function localSlicerAvailable(printxPrinterId: string): boolean {
  const profile = PRINTER_PROFILES[printxPrinterId]
  if (!profile || !resolveLocalSlicerBin()) return false
  return Boolean(resolveVendorProfileRoot(profile.vendor))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    const onData = (chunk: Buffer) => {
      log += chunk.toString('utf8')
      if (log.length > 200_000) log = log.slice(-100_000)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Local slicer timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, log })
    })
  })
}

function parseGramsHoursFromGcode(text: string): { grams: number; hours: number } {
  const weight = /total filament weight\s*\[g\]\s*:\s*([0-9.]+)/i.exec(text)
  const lengthMm = /total filament length\s*\[mm\]\s*:\s*([0-9.]+)/i.exec(text)
  const diameter = /filament_diameter:\s*([0-9.]+)/i.exec(text)
  const density = /filament_density:\s*([0-9.]+)/i.exec(text)
  const time =
    /total estimated time:\s*(\d+)h\s*(\d+)m\s*(\d+)s/i.exec(text) ||
    /total estimated time:\s*(\d+)m\s*(\d+)s/i.exec(text) ||
    /model printing time:\s*(\d+)m\s*(\d+)s/i.exec(text)
  let grams = weight ? Number(weight[1]) : 0
  if ((!Number.isFinite(grams) || grams <= 0) && lengthMm) {
    const L = Number(lengthMm[1])
    const d = Number(diameter?.[1] || 1.75)
    const rho = Number(density?.[1] || 0) > 0 ? Number(density?.[1]) : 1.24
    // mm length * mm² cross-section * g/cm³ → grams
    grams = (L * Math.PI * (d / 2) ** 2 * rho) / 1000
  }
  let hours = 0
  if (time) {
    if (time.length === 4) {
      hours = Number(time[1]) + Number(time[2]) / 60 + Number(time[3]) / 3600
    } else {
      hours = Number(time[1]) / 60 + Number(time[2]) / 3600
    }
  }
  if (!Number.isFinite(grams) || grams < 0) grams = 0
  if (!Number.isFinite(hours) || hours < 0) hours = 0
  return {
    grams: Math.round(grams * 100) / 100,
    hours: Math.round(hours * 1000) / 1000,
  }
}

function parseGramsHoursFromResultJson(raw: string): { grams: number; hours: number } | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    const plates = data.sliced_plates as Array<Record<string, unknown>> | undefined
    const plate = plates?.[0]
    if (!plate) return null
    const seconds = Number(plate.total_predication ?? plate.main_predication ?? 0)
    let grams = 0
    const filaments = plate.filaments as Array<Record<string, unknown>> | undefined
    if (filaments?.length) {
      grams = filaments.reduce((sum, f) => sum + Number(f.total_used_g ?? f.main_used_g ?? 0), 0)
    }
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    return {
      grams: Math.round(Math.max(0, grams) * 100) / 100,
      hours: Math.round((seconds / 3600) * 1000) / 1000,
    }
  } catch {
    return null
  }
}

/** Slice an STL with the local Bambu/Orca CLI for a PrintX printer id. */
export async function sliceStlLocally(
  localPath: string,
  printxPrinterId: string,
): Promise<LocalSliceResult> {
  const profile = PRINTER_PROFILES[printxPrinterId]
  if (!profile) {
    throw new Error(`No local slicer profile for printer "${printxPrinterId}".`)
  }
  const bin = resolveLocalSlicerBin()
  if (!bin) {
    throw new Error(
      'Local slicer not found. Install Bambu Studio, or set PRINTX_SLICER_BIN / PRINTX_SLICER_HOME.',
    )
  }
  const root = resolveVendorProfileRoot(profile.vendor)
  if (!root) {
    throw new Error(
      `Slicer profiles for ${profile.vendor} not found. Set PRINTX_SLICER_PROFILES to …/profiles.`,
    )
  }

  const machine = path.join(root, profile.machine)
  const processFile = path.join(root, profile.process)
  const filament = path.join(root, profile.filament)
  for (const f of [machine, processFile, filament, localPath]) {
    if (!fs.existsSync(f)) throw new Error(`Slicer input missing: ${f}`)
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printx-slice-'))
  try {
    const args = [
      '--load-settings',
      `${machine};${processFile}`,
      '--load-filaments',
      filament,
      '--orient',
      '1',
      '--arrange',
      '1',
      '--slice',
      '0',
      '--no-check',
      '--outputdir',
      outDir,
      localPath,
    ]
    console.warn('[local-slicer] slicing', printxPrinterId, path.basename(localPath))
    const { code, log } = await run(bin, args, 10 * 60_000)
    const gcodePath =
      fs.readdirSync(outDir)
        .filter((n) => n.endsWith('.gcode'))
        .map((n) => path.join(outDir, n))
        .sort()[0] || ''
    if (!gcodePath || !fs.existsSync(gcodePath)) {
      const resultPath = path.join(outDir, 'result.json')
      const resultHint = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8').slice(0, 400) : ''
      throw new Error(
        `Local slicer failed (exit ${code}). ${resultHint || log.slice(-500) || 'No G-code produced.'}`,
      )
    }

    const buffer = fs.readFileSync(gcodePath)
    if (!buffer.length) throw new Error('Local slicer produced an empty G-code file.')

    const head = buffer.subarray(0, 8000).toString('utf8')
    let metrics = parseGramsHoursFromGcode(head)
    const resultPath = path.join(outDir, 'result.json')
    if ((metrics.grams <= 0 || metrics.hours <= 0) && fs.existsSync(resultPath)) {
      const fromJson = parseGramsHoursFromResultJson(fs.readFileSync(resultPath, 'utf8'))
      if (fromJson) {
        if (metrics.grams <= 0) metrics = { ...metrics, grams: fromJson.grams }
        if (metrics.hours <= 0) metrics = { ...metrics, hours: fromJson.hours }
      }
    }

    // Allow filesystem flush on slow hosts
    await sleep(10)

    return {
      buffer,
      filename: path.basename(gcodePath),
      grams: metrics.grams,
      hours: metrics.hours,
    }
  } finally {
    try {
      fs.rmSync(outDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
